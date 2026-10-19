import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import {
  DEFAULT_GAME_PORT,
  DEFAULT_OVERLAY_PORT,
  type ConnectionStatus,
  type OverlayMessage,
  type PacksSnapshot,
  type SessionState
} from '@core/index'
import { loadCapture } from '@core/test-utils/loadCapture'
import { GAME_WEB_PORT } from '@game/index'
import { DEFAULT_OVERLAY_PORT as SERVER_DEFAULT_PORT } from '@server/index'
import { createDemoPack } from '@server/test-utils/fixtures'
import { Services, toConnectionStatus } from './services'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor : délai dépassé')
    await sleep(10)
  }
}

/** Faux jeu : un serveur WebSocket qui envoie une capture dès qu'un client se connecte. */
async function fakeGame(
  frames: { raw: string }[]
): Promise<{ port: number; close: () => Promise<void> }> {
  const http: Server = createServer()
  const wss = new WebSocketServer({ server: http })
  wss.on('connection', (socket) => {
    for (const f of frames) socket.send(f.raw)
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  return {
    port: (http.address() as AddressInfo).port,
    close: async () => {
      for (const c of wss.clients) c.terminate()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve) => http.close(() => resolve()))
    }
  }
}

/** Port libre : on le réserve puis on le libère, personne n'écoute dessus. */
async function freePort(): Promise<number> {
  const probe = await fakeGame([])
  await probe.close()
  return probe.port
}

describe('Services', () => {
  let base: string
  let configFile: string
  let overlaysDir: string
  const cleanups: (() => Promise<void> | void)[] = []

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'rl-studio-services-'))
    configFile = join(base, 'userData', 'config.json')
    await createDemoPack(base)
    overlaysDir = join(base, 'overlays')
    // Le dossier « leurre » de la fixture (sans manifeste) apparaîtrait comme un pack invalide.
    await rm(join(overlaysDir, 'demo-evil'), { recursive: true })
  })
  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn()
    await rm(base, { recursive: true, force: true })
  })

  /** Crée des services (ports libres, jeu absent par défaut) et les arrête en fin de test. */
  async function create(options: { gamePort?: number; start?: boolean } = {}): Promise<Services> {
    const services = new Services({
      configFile,
      overlaysDir,
      sdkSource: '/* SDK de test */',
      overlayPort: 0,
      gameWebPort: options.gamePort ?? (await freePort())
    })
    cleanups.push(() => services.stop())
    if (options.start !== false) await services.start()
    return services
  }

  async function overlay(services: Services, query = ''): Promise<OverlayMessage[]> {
    const messages: OverlayMessage[] = []
    const ws = new WebSocket(`ws://127.0.0.1:${services.server.port}/ws${query}`)
    cleanups.push(() => ws.terminate())
    ws.on('message', (d) => messages.push(JSON.parse(d.toString())))
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('error', reject)
    })
    return messages
  }

  const lastSession = (m: OverlayMessage[]): SessionState | undefined =>
    m.findLast((x) => x.type === 'session')?.payload as SessionState | undefined

  describe('démarrage', () => {
    it('charge les packs, démarre le serveur et publie l’état initial', async () => {
      const services = await create()
      const state = services.getState()
      expect(state.connection).toBe('game-closed')
      expect(state.session).toMatchObject({ wins: 0, losses: 0, lastResult: null })
      expect(state.packs.packs.map((p) => p.id)).toEqual(['demo'])
      expect(state.overlayBaseUrl).toBe(`http://127.0.0.1:${services.server.port}`)
    })

    it('un overlay qui se connecte reçoit un état cohérent, même sans jeu', async () => {
      const services = await create()
      const messages = await overlay(services)
      await waitFor(() => messages.length === 3)
      expect(messages.map((m) => m.type)).toEqual(['session', 'match', 'connection'])
      expect(messages[1].payload).toBeNull()
      expect(messages[2].payload).toEqual({ status: 'game-closed' })
    })

    it('sert le SDK et les pages des packs', async () => {
      const services = await create()
      const sdk = await fetch(`${services.overlayBaseUrl()}/sdk/rlstudio.js`)
      expect(await sdk.text()).toBe('/* SDK de test */')
      const page = await fetch(`${services.overlayBaseUrl()}/overlay/demo/bar`)
      expect(page.status).toBe(200)
    })

    it('start() deux fois est sans effet', async () => {
      const services = await create()
      const port = services.server.port
      await services.start()
      expect(services.server.port).toBe(port)
    })

    it('un dossier de packs absent ne gêne pas le démarrage', async () => {
      await rm(overlaysDir, { recursive: true })
      const services = await create()
      expect(services.getState().packs).toEqual({ packs: [], invalid: [] })
    })

    it('port déjà pris : erreur claire, et la connexion au jeu n’est pas démarrée', async () => {
      const first = await create()
      const game = await fakeGame([])
      cleanups.push(game.close)
      const second = new Services({
        configFile: join(base, 'autre.json'),
        overlaysDir,
        sdkSource: '',
        overlayPort: first.server.port,
        gameWebPort: game.port
      })
      await expect(second.start()).rejects.toThrow(`Le port ${first.server.port} est déjà utilisé`)
      expect(second.connection.isRunning).toBe(false)
    })

    it('utilise les ports de la config quand rien ne les remplace', async () => {
      await mkdir(join(base, 'userData'), { recursive: true })
      await writeFile(configFile, JSON.stringify({ overlayPort: 50123, gameWebPort: 50124 }))
      const services = new Services({ configFile, overlaysDir, sdkSource: '' })
      expect(services.overlayBaseUrl()).toBe('http://127.0.0.1:50123')
      expect(services.config.config.gameWebPort).toBe(50124)
    })

    it('un fichier de config corrompu est signalé, les défauts sont utilisés', async () => {
      await mkdir(join(base, 'userData'), { recursive: true })
      await writeFile(configFile, '{ cassé')
      const services = new Services({ configFile, overlaysDir, sdkSource: '', overlayPort: 0 })
      expect(services.configRecovered).toBe(true)
      expect(services.config.config.overlayPort).toBe(49200)
    })
  })

  describe('ports par défaut cohérents entre les couches', () => {
    it('config, serveur et connexion au jeu utilisent les mêmes valeurs', () => {
      expect(DEFAULT_OVERLAY_PORT).toBe(SERVER_DEFAULT_PORT)
      expect(DEFAULT_GAME_PORT).toBe(GAME_WEB_PORT)
    })
  })

  describe('de bout en bout avec un faux jeu', () => {
    it('une partie jouée arrive aux overlays et au client', async () => {
      const game = await fakeGame(loadCapture('2026-10-01_match-complet'))
      cleanups.push(game.close)
      const services = new Services({
        configFile,
        overlaysDir,
        sdkSource: '',
        overlayPort: 0,
        gameWebPort: game.port
      })
      cleanups.push(() => services.stop())

      const statuses: ConnectionStatus[] = []
      const sessions: SessionState[] = []
      services.onConnection((s) => statuses.push(s))
      services.onSession((s) => sessions.push(s))

      await services.start()
      const messages = await overlay(services, '?module=demo/bar') // data : session

      await waitFor(() => services.getState().session.wins === 1)
      await waitFor(() => lastSession(messages)?.wins === 1)

      expect(statuses).toEqual(['connected'])
      expect(services.getState().connection).toBe('connected')
      expect(sessions).toHaveLength(1)
      expect(sessions[0]).toMatchObject({ wins: 1, losses: 0, streak: 1 })
    })

    it('mémorise le joueur local dans la config, et le retrouve au lancement suivant', async () => {
      const game = await fakeGame(loadCapture('2026-10-01_match-complet'))
      cleanups.push(game.close)
      const first = new Services({
        configFile,
        overlaysDir,
        sdkSource: '',
        overlayPort: 0,
        gameWebPort: game.port
      })
      await first.start()
      await waitFor(() => first.pipeline.tracker.localPlayerId !== null)
      await waitFor(() => first.config.config.localPlayerId !== null)
      await first.stop()

      const saved = JSON.parse(await readFile(configFile, 'utf8'))
      expect(saved.localPlayerId).toMatch(/^Epic\|/)

      const second = await create()
      expect(second.pipeline.tracker.localPlayerId).toBe(saved.localPlayerId)
    })

    it('le jeu se ferme : le statut repasse à « game-closed » et se rétablit tout seul', async () => {
      const frames = loadCapture('2026-10-01_freeplay')
      let game = await fakeGame(frames)
      const port = game.port
      const services = await create({ gamePort: port })
      await waitFor(() => services.getState().connection === 'connected')

      await game.close()
      await waitFor(() => services.getState().connection === 'game-closed')

      game = await (async () => {
        // on relance un faux jeu sur le même port
        const http = createServer()
        const wss = new WebSocketServer({ server: http })
        await new Promise<void>((resolve) => http.listen(port, '127.0.0.1', resolve))
        return {
          port,
          close: async () => {
            for (const c of wss.clients) c.terminate()
            await new Promise<void>((resolve) => wss.close(() => resolve()))
            await new Promise<void>((resolve) => http.close(() => resolve()))
          }
        }
      })()
      cleanups.push(game.close)
      await waitFor(() => services.getState().connection === 'connected', 8000)
    })

    it('reset de session : remet à zéro, prévient le client et les overlays', async () => {
      const game = await fakeGame(loadCapture('2026-10-01_match-complet'))
      cleanups.push(game.close)
      const services = new Services({
        configFile,
        overlaysDir,
        sdkSource: '',
        overlayPort: 0,
        gameWebPort: game.port
      })
      cleanups.push(() => services.stop())
      await services.start()
      const messages = await overlay(services, '?topics=session')
      await waitFor(() => services.getState().session.wins === 1)

      const seen: SessionState[] = []
      services.onSession((s) => seen.push(s))
      expect(services.resetSession()).toMatchObject({ wins: 0, losses: 0 })

      expect(seen).toHaveLength(1)
      await waitFor(() => lastSession(messages)?.wins === 0)
    })
  })

  describe('modules', () => {
    it('active un module, l’annonce, le mémorise sur disque et au lancement suivant', async () => {
      const services = await create()
      const announced: PacksSnapshot[] = []
      services.onPacks((p) => announced.push(p))

      const snapshot = await services.setModuleEnabled('demo/bar', true)
      expect(snapshot.packs[0].modules.find((m) => m.id === 'bar')?.enabled).toBe(true)
      expect(snapshot.packs[0].modules.find((m) => m.id === 'racine')?.enabled).toBe(false)
      expect(announced).toHaveLength(1)
      expect(announced[0]).toEqual(snapshot)

      await services.stop()
      expect(JSON.parse(await readFile(configFile, 'utf8')).modules).toEqual({
        'demo/bar': { enabled: true }
      })

      const next = await create()
      expect(next.getState().packs.packs[0].modules.find((m) => m.id === 'bar')?.enabled).toBe(true)
    })

    it('désactive un module activé', async () => {
      const services = await create()
      await services.setModuleEnabled('demo/bar', true)
      const snapshot = await services.setModuleEnabled('demo/bar', false)
      expect(snapshot.packs[0].modules.find((m) => m.id === 'bar')?.enabled).toBe(false)
    })

    it('refuse un module inconnu ou une clé invalide', async () => {
      const services = await create()
      await expect(services.setModuleEnabled('demo/inconnu', true)).rejects.toThrow('introuvable')
      await expect(services.setModuleEnabled('inconnu/bar', true)).rejects.toThrow('introuvable')
      await expect(services.setModuleEnabled('../x', true)).rejects.toThrow('invalide')
      expect(services.config.config.modules).toEqual({})
    })

    it('désactiver un module jamais activé n’écrit rien', async () => {
      const services = await create()
      await services.setModuleEnabled('demo/inconnu', false)
      expect(services.config.config.modules).toEqual({})
    })

    it('un module activé dont le pack a disparu n’apparaît plus, et se purge en le désactivant', async () => {
      const services = await create()
      await services.setModuleEnabled('demo/bar', true)
      await rm(join(overlaysDir, 'demo'), { recursive: true })
      const snapshot = await services.reloadPacks()
      expect(snapshot.packs).toEqual([])
      await services.setModuleEnabled('demo/bar', false)
      expect(services.config.config.modules['demo/bar']).toEqual({ enabled: false })
    })

    it('recharger les packs voit un pack ajouté et prévient', async () => {
      const services = await create()
      const announced: PacksSnapshot[] = []
      services.onPacks((p) => announced.push(p))

      const dir = join(overlaysDir, 'nouveau')
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, 'manifest.json'),
        JSON.stringify({
          manifestVersion: 1,
          name: 'Nouveau',
          version: '1.0.0',
          modules: [{ id: 'm', name: 'M', entry: 'm.html', size: { width: 10, height: 10 } }]
        })
      )
      await writeFile(join(dir, 'm.html'), '<html></html>')

      const snapshot = await services.reloadPacks()
      expect(snapshot.packs.map((p) => p.id)).toEqual(['demo', 'nouveau'])
      expect(announced).toHaveLength(1)

      // le serveur sert tout de suite le nouveau pack
      const res = await fetch(`${services.overlayBaseUrl()}/overlay/nouveau/m`)
      expect(res.status).toBe(200)
    })

    it('un pack invalide est listé avec ses erreurs', async () => {
      await mkdir(join(overlaysDir, 'casse'), { recursive: true })
      await writeFile(join(overlaysDir, 'casse', 'manifest.json'), '{')
      const services = await create()
      expect(services.getState().packs.invalid).toHaveLength(1)
      expect(services.getState().packs.invalid[0].id).toBe('casse')
    })
  })

  describe('arrêt propre', () => {
    it('stop() coupe la connexion au jeu, ferme le serveur et ses clients', async () => {
      const game = await fakeGame(loadCapture('2026-10-01_freeplay'))
      cleanups.push(game.close)
      const services = new Services({
        configFile,
        overlaysDir,
        sdkSource: '',
        overlayPort: 0,
        gameWebPort: game.port
      })
      await services.start()
      const port = services.server.port
      await waitFor(() => services.getState().connection === 'connected')
      const client = new WebSocket(`ws://127.0.0.1:${port}/ws`)
      await new Promise<void>((resolve) => client.once('open', () => resolve()))
      const closed = new Promise<number>((resolve) => client.once('close', (code) => resolve(code)))

      await services.stop()

      expect(await closed).toBe(1001)
      expect(services.connection.isRunning).toBe(false)
      expect(services.server.isRunning).toBe(false)
      await expect(fetch(`http://127.0.0.1:${port}/sdk/rlstudio.js`)).rejects.toThrow()
    })

    it('stop() attend l’écriture de la config en cours', async () => {
      const services = await create()
      void services.config.update((c) => {
        c.localPlayerId = 'Epic|x|0'
      })
      await services.stop()
      expect(JSON.parse(await readFile(configFile, 'utf8')).localPlayerId).toBe('Epic|x|0')
    })

    it('stop() est idempotent, et on peut redémarrer ensuite', async () => {
      const services = await create()
      await services.stop()
      await services.stop()
      await services.start()
      expect(services.server.isRunning).toBe(true)
    })

    it('se désabonner coupe l’écoute', async () => {
      const services = await create()
      const got: PacksSnapshot[] = []
      const off = services.onPacks((p) => got.push(p))
      off()
      await services.reloadPacks()
      expect(got).toEqual([])
    })
  })

  describe('toConnectionStatus', () => {
    it('connecté ↔ connected ; coupé → game-closed (provisoire, P5)', () => {
      expect(toConnectionStatus('connected')).toBe('connected')
      expect(toConnectionStatus('disconnected')).toBe('game-closed')
    })
  })
})
