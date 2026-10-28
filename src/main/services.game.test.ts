import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import type { ConnectionStatus, GameInstall } from '@core/index'
import type { GameHost } from '@game/index'
import { createDemoPack } from '@server/test-utils/fixtures'
import { Services } from './services'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitFor(condition: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor : délai dépassé')
    await sleep(10)
  }
}

const INI = '[TAGame.MatchStatsExporter_TA]\nPacketSendRate=0\nPort=49123\nWebPort=49124\n'

/** Faux hôte : le « jeu » est un simple booléen, les appels sont journalisés. */
function fakeHost(installs: GameInstall[]): GameHost & { running: boolean; log: string[] } {
  const host = {
    running: false,
    log: [] as string[],
    detectInstalls: async () => installs,
    isRunning: async () => host.running,
    closeGame: async () => {
      host.log.push('close')
      host.running = false
    },
    launch: async (launcher: string) => {
      host.log.push(`launch ${launcher}`)
      host.running = true
    }
  }
  return host
}

describe('Services : jeu (installation, ini, relance, commandes)', () => {
  let base: string
  let gameDir: string
  const started: Services[] = []
  const closers: (() => Promise<void>)[] = []

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'rl-studio-game-'))
    await createDemoPack(base)
    gameDir = join(base, 'steamapps', 'common', 'rocketleague')
    await mkdir(join(gameDir, 'TAGame', 'Config'), { recursive: true })
    await writeFile(join(gameDir, 'TAGame', 'Config', 'TAStatsAPI.ini'), INI)
  })
  afterEach(async () => {
    for (const s of started.splice(0)) await s.stop()
    for (const close of closers.splice(0)) await close()
    await rm(base, { recursive: true, force: true })
  })

  async function create(host: GameHost, gameWebPort = 1): Promise<Services> {
    const services = new Services({
      configFile: join(base, 'userData', 'config.json'),
      overlaysDir: join(base, 'overlays'),
      sdkSource: '',
      overlayPort: 0,
      gameWebPort,
      gameHost: host
    })
    started.push(services)
    await services.start()
    return services
  }

  const steam: GameInstall = { dir: '', launcher: 'steam' }
  const install = (): GameInstall => ({ ...steam, dir: gameDir })

  it('détecte l’installation et lit l’ini', async () => {
    const services = await create(fakeHost([install()]))
    const info = await services.getGameSetup()
    expect(info.install).toEqual(install())
    expect(info.candidates).toHaveLength(1)
    expect(info.ini).toMatchObject({ found: true, enabled: false, hasBackup: false })
    expect(info.processRunning).toBe(false)
  })

  it('sans installation détectée : rien, jusqu’au choix d’un dossier valide', async () => {
    const services = await create(fakeHost([]))
    expect((await services.getGameSetup()).install).toBeNull()

    await expect(services.setGameDir(join(base, 'nope'))).rejects.toThrow(/ne contient pas/)
    const info = await services.setGameDir(gameDir)
    expect(info.install?.dir).toBe(gameDir)
    expect(info.install?.launcher).toBe('steam')

    // le choix est enregistré, et « null » revient à la détection automatique
    const saved = JSON.parse(await readFile(services.config.path, 'utf8')) as { gameDir: string }
    expect(saved.gameDir).toBe(gameDir)
    expect((await services.setGameDir(null)).install).toBeNull()
  })

  it('active l’API dans l’ini avec sauvegarde, valide le débit, puis restaure', async () => {
    const services = await create(fakeHost([install()]))
    await expect(services.configureStatsApi(500)).rejects.toThrow(/0 à 120/)

    const info = await services.configureStatsApi(30)
    expect(info.ini).toMatchObject({ found: true, enabled: true, hasBackup: true })
    expect(await readFile(join(gameDir, 'TAGame', 'Config', 'TAStatsAPI.ini'), 'utf8')).toContain(
      'PacketSendRate=30'
    )

    const restored = await services.restoreStatsApi()
    expect(restored.ini).toMatchObject({ enabled: false })
  })

  it('statut : jeu fermé → jeu lancé sans API → connecté', async () => {
    const host = fakeHost([install()])
    const services = await create(host, 1) // port fermé : l'API ne répond pas
    const seen: ConnectionStatus[] = []
    services.onConnection((s) => seen.push(s))
    expect(services.getState().connection).toBe('game-closed')

    host.running = true
    await waitFor(() => services.getState().connection === 'api-disabled', 6000)
    expect(seen).toEqual(['api-disabled'])
  }, 10_000)

  it('relance : ferme le jeu puis le relance par sa boutique', async () => {
    const host = fakeHost([install()])
    host.running = true
    const services = await create(host)
    await services.restartGame()
    expect(host.log).toEqual(['close', 'launch steam'])
  })

  it('relance : refuse sans installation, ou sans boutique connue', async () => {
    const none = await create(fakeHost([]))
    await expect(none.restartGame()).rejects.toThrow(/introuvable/)

    const unknown = await create(fakeHost([{ dir: gameDir, launcher: null }]))
    await expect(unknown.restartGame()).rejects.toThrow(/Boutique/)
  })

  it('commande HUD : envoyée au jeu en objet, refusée hors connexion', async () => {
    const received: string[] = []
    const http = createServer()
    const wss = new WebSocketServer({ server: http })
    wss.on('connection', (socket) => socket.on('message', (m) => received.push(m.toString())))
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
    const port = (http.address() as AddressInfo).port
    closers.push(async () => {
      for (const c of wss.clients) c.terminate()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve) => http.close(() => resolve()))
    })

    const offline = await create(fakeHost([]), 1)
    expect(() => offline.setGameHud(false)).toThrow(/pas connecté/)

    const services = await create(fakeHost([]), port)
    await waitFor(() => services.getState().connection === 'connected')
    services.setGameHud(false)
    await waitFor(() => received.length === 1)
    expect(JSON.parse(received[0])).toEqual({
      Command: 'SetHUDVisibility',
      Data: { bVisible: false }
    })
  })
})
