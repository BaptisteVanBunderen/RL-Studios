import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { LoadedPack, OverlayMessage, SessionState } from '@core/index'
import { OverlayServer, type PackSource } from './OverlayServer'
import { createDemoPack, packSource } from './test-utils/fixtures'

interface Client {
  ws: WebSocket
  messages: OverlayMessage[]
  types: () => string[]
}

const opened: WebSocket[] = []

async function open(port: number, query: string): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`)
  opened.push(ws)
  const messages: OverlayMessage[] = []
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())))
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
  return { ws, messages, types: () => messages.map((m) => m.type) }
}

function refused(port: number, query: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`)
    ws.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0)
      ws.terminate()
    })
    ws.once('open', () => reject(new Error('connexion acceptée')))
    ws.once('error', () => {})
  })
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor : délai dépassé')
    await sleep(5)
  }
}

const session = (wins: number): SessionState => ({
  wins,
  losses: 0,
  streak: wins,
  bestStreak: wins,
  lastResult: null,
  stats: { goals: 0, assists: 0, saves: 0, shots: 0, demos: 0, demosTaken: 0 }
})

describe('OverlayServer : modules et réglages', () => {
  let base: string
  let server: OverlayServer
  let packs: Map<string, LoadedPack>
  let source: PackSource
  let settingsNow: Record<string, unknown> | null

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'rl-studio-mod-'))
    packs = new Map([['demo', await createDemoPack(base)]])
    const defaults = packSource(packs)
    settingsNow = null
    // Les réglages peuvent être remplacés par le test (valeurs de l'utilisateur).
    source = {
      getPack: defaults.getPack,
      getSettings: (p, m) => settingsNow ?? defaults.getSettings(p, m)
    }
    server = new OverlayServer({ port: 0, matchIntervalMs: 5, packs: source })
    await server.start()
    server.publish('session', session(2))
    server.publish('match', null)
    server.publish('connection', { status: 'connected' })
  })

  afterEach(async () => {
    for (const ws of opened.splice(0)) ws.terminate()
    await server.stop()
    await rm(base, { recursive: true, force: true })
  })

  describe('?module=<pack>/<module>', () => {
    it('envoie d’abord les réglages du module, puis les topics de son champ data', async () => {
      const c = await open(server.port, '?module=demo/bar') // data: ['session']
      await waitFor(() => c.messages.length === 2)
      await sleep(30)
      expect(c.types()).toEqual(['settings', 'session'])
      expect(c.messages[0].payload).toEqual({ color: '#ff0000' }) // défauts du manifeste
      expect(c.messages[1].payload).toEqual(session(2))
    })

    it('un autre module reçoit d’autres topics', async () => {
      const c = await open(server.port, '?module=demo/nohead') // data: ['match', 'event']
      await waitFor(() => c.messages.length === 2)
      await sleep(30)
      expect(c.types()).toEqual(['settings', 'match'])
      expect(c.messages[0].payload).toEqual({})
      expect(c.messages[1].payload).toBeNull()
    })

    it('un module sans data ne reçoit que ses réglages', async () => {
      const c = await open(server.port, '?module=demo/vide')
      await waitFor(() => c.messages.length === 1)
      await sleep(30)
      expect(c.types()).toEqual(['settings'])
    })

    it('reçoit ensuite en direct ses topics, et seulement eux', async () => {
      const c = await open(server.port, '?module=demo/bar')
      await waitFor(() => c.messages.length === 2)
      server.publish('session', session(3))
      server.publish('match', null)
      server.publish('event', { type: 'matchCreated', matchGuid: 'G' })
      await waitFor(() => c.messages.length === 3)
      await sleep(40)
      expect(c.types()).toEqual(['settings', 'session', 'session'])
    })

    it('lit les réglages au moment de la connexion (valeurs de l’utilisateur)', async () => {
      settingsNow = { color: '#00ff00' }
      const c = await open(server.port, '?module=demo/bar')
      await waitFor(() => c.messages.length >= 1)
      expect(c.messages[0].payload).toEqual({ color: '#00ff00' })
    })

    it('?topics explicite l’emporte sur le champ data du module', async () => {
      const c = await open(server.port, '?module=demo/bar&topics=match')
      await waitFor(() => c.messages.length === 2)
      await sleep(30)
      expect(c.types()).toEqual(['settings', 'match'])
    })

    it('sans ?module, aucun message settings (outil de développement)', async () => {
      const c = await open(server.port, '')
      await waitFor(() => c.messages.length === 3)
      await sleep(30)
      expect(c.types()).toEqual(['session', 'match', 'connection'])
    })
  })

  describe('module introuvable : refus 404', () => {
    it.each([
      '?module=demo/inconnu',
      '?module=inconnu/bar',
      '?module=demo',
      '?module=demo/bar/extra',
      '?module=../bar',
      '?module=DEMO/bar',
      '?module='
    ])('%s', async (query) => {
      expect(await refused(server.port, query)).toBe(404)
    })

    it('un pack retiré après coup n’est plus joignable', async () => {
      packs.delete('demo')
      expect(await refused(server.port, '?module=demo/bar')).toBe(404)
    })

    it('un serveur sans packs refuse tout ?module', async () => {
      const bare = new OverlayServer({ port: 0 })
      await bare.start()
      try {
        expect(await refused(bare.port, '?module=demo/bar')).toBe(404)
      } finally {
        await bare.stop()
      }
    })
  })

  describe('publishSettings', () => {
    it('atteint les overlays de ce module sans rechargement, et eux seuls', async () => {
      const bar1 = await open(server.port, '?module=demo/bar')
      const bar2 = await open(server.port, '?module=demo/bar')
      const other = await open(server.port, '?module=demo/nohead')
      const dev = await open(server.port, '')
      await waitFor(() => bar1.messages.length === 2 && other.messages.length === 2)
      await waitFor(() => dev.messages.length === 3 && bar2.messages.length === 2)

      server.publishSettings('demo/bar', { color: '#0000ff' })

      await waitFor(() => bar1.messages.length === 3 && bar2.messages.length === 3)
      await sleep(40)
      expect(bar1.messages[2]).toEqual({ v: 1, type: 'settings', payload: { color: '#0000ff' } })
      expect(bar2.messages[2].payload).toEqual({ color: '#0000ff' })
      expect(other.messages).toHaveLength(2)
      expect(dev.messages).toHaveLength(3)
    })

    it('ne plante pas quand personne n’est connecté', () => {
      expect(() => server.publishSettings('demo/bar', {})).not.toThrow()
    })

    it('un overlay qui se reconnecte reçoit les nouveaux réglages', async () => {
      settingsNow = { color: '#123456' }
      const c = await open(server.port, '?module=demo/bar')
      await waitFor(() => c.messages.length >= 1)
      expect(c.messages[0].payload).toEqual({ color: '#123456' })
    })
  })
})
