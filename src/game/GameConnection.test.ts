import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { GameConnection, type LinkStatus } from './GameConnection'

// Faux jeu : un vrai serveur WebSocket local, sur un port libre choisi par l'OS.

interface FakeGame {
  port: number
  wss: WebSocketServer
  http: Server
  clients: () => number
  broadcast: (raw: string) => void
  close: () => Promise<void>
}

async function startFakeGame(port = 0): Promise<FakeGame> {
  const http = createServer()
  const wss = new WebSocketServer({ server: http })
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(port, '127.0.0.1', resolve)
  })
  return {
    port: (http.address() as AddressInfo).port,
    wss,
    http,
    clients: () => wss.clients.size,
    broadcast: (raw) => wss.clients.forEach((c) => c.send(raw)),
    close: async () => {
      for (const c of wss.clients) c.terminate()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve) => http.close(() => resolve()))
    }
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor : délai dépassé')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const FAST = { initialRetryDelayMs: 20, maxRetryDelayMs: 80, handshakeTimeoutMs: 500 }

describe('GameConnection', () => {
  const games: FakeGame[] = []
  const connections: GameConnection[] = []

  afterEach(async () => {
    for (const c of connections.splice(0)) c.stop()
    for (const g of games.splice(0)) await g.close().catch(() => {})
  })

  async function fakeGame(port = 0): Promise<FakeGame> {
    const g = await startFakeGame(port)
    games.push(g)
    return g
  }
  function connection(port: number): GameConnection {
    const c = new GameConnection({ port, ...FAST })
    connections.push(c)
    return c
  }

  it('se connecte et reçoit les messages bruts tels quels, horodatés', async () => {
    const game = await fakeGame()
    const conn = connection(game.port)
    const frames: { t: number; raw: string }[] = []
    conn.onFrame((f) => frames.push(f))

    conn.start()
    await waitFor(() => conn.status === 'connected')

    const raw = JSON.stringify({ Event: 'MatchCreated', Data: '{"MatchGuid":"X"}' })
    game.broadcast(raw)
    await waitFor(() => frames.length === 1)

    expect(frames[0].raw).toBe(raw)
    expect(frames[0].t).toBeGreaterThanOrEqual(0)
  })

  it('les trames suivantes ont un t croissant', async () => {
    const game = await fakeGame()
    const conn = connection(game.port)
    const frames: { t: number; raw: string }[] = []
    conn.onFrame((f) => frames.push(f))
    conn.start()
    await waitFor(() => conn.status === 'connected')

    game.broadcast('a')
    await new Promise((r) => setTimeout(r, 30))
    game.broadcast('b')
    await waitFor(() => frames.length === 2)

    expect(frames[1].t).toBeGreaterThan(frames[0].t)
  })

  it('jeu absent : retente sans planter, puis se connecte dès que le jeu apparaît', async () => {
    // On réserve un port libre, on le libère : personne n'écoute dessus.
    const probe = await startFakeGame()
    const port = probe.port
    await probe.close()

    const conn = connection(port)
    const statuses: LinkStatus[] = []
    conn.onStatus((s) => statuses.push(s))
    conn.start()

    await new Promise((r) => setTimeout(r, 150)) // plusieurs tentatives échouées
    expect(conn.status).toBe('disconnected')
    expect(statuses).toEqual([]) // jamais connecté : pas de changement d'état

    const game = await fakeGame(port) // le jeu se lance
    await waitFor(() => conn.status === 'connected')
    expect(statuses).toEqual(['connected'])
    expect(game.clients()).toBe(1)
  })

  it('perd le jeu puis se reconnecte tout seul', async () => {
    const game = await fakeGame()
    const port = game.port
    const conn = connection(port)
    const statuses: LinkStatus[] = []
    const raws: string[] = []
    conn.onStatus((s) => statuses.push(s))
    conn.onFrame((f) => raws.push(f.raw))

    conn.start()
    await waitFor(() => conn.status === 'connected')

    await game.close() // le jeu se ferme
    await waitFor(() => conn.status === 'disconnected')

    const game2 = await fakeGame(port) // le jeu est relancé
    await waitFor(() => conn.status === 'connected')
    game2.broadcast('après-relance')
    await waitFor(() => raws.includes('après-relance'))

    expect(statuses).toEqual(['connected', 'disconnected', 'connected'])
  })

  it('stop() coupe la connexion et n’en rouvre pas', async () => {
    const game = await fakeGame()
    const conn = connection(game.port)
    conn.start()
    await waitFor(() => conn.status === 'connected')

    conn.stop()
    expect(conn.status).toBe('disconnected')
    expect(conn.isRunning).toBe(false)
    await waitFor(() => game.clients() === 0)

    await new Promise((r) => setTimeout(r, 150)) // plusieurs délais de reprise
    expect(game.clients()).toBe(0)
  })

  it('start() peut suivre un stop() ; un second start() en cours est sans effet', async () => {
    const game = await fakeGame()
    const conn = connection(game.port)
    conn.start()
    conn.start()
    await waitFor(() => conn.status === 'connected')
    expect(game.clients()).toBe(1)

    conn.stop()
    await waitFor(() => game.clients() === 0)
    conn.start()
    await waitFor(() => conn.status === 'connected')
    expect(game.clients()).toBe(1)
  })

  it('un abonné qui plante ne coupe pas la connexion et ne prive pas les autres', async () => {
    const game = await fakeGame()
    const conn = connection(game.port)
    const got: string[] = []
    conn.onFrame(() => {
      throw new Error('boum')
    })
    conn.onFrame((f) => got.push(f.raw))

    conn.start()
    await waitFor(() => conn.status === 'connected')
    game.broadcast('un')
    game.broadcast('deux')
    await waitFor(() => got.length === 2)

    expect(conn.status).toBe('connected')
  })

  it('se désabonner coupe l’abonné', async () => {
    const game = await fakeGame()
    const conn = connection(game.port)
    const got: string[] = []
    const off = conn.onFrame((f) => got.push(f.raw))
    conn.start()
    await waitFor(() => conn.status === 'connected')

    off()
    game.broadcast('ignoré')
    await new Promise((r) => setTimeout(r, 50))
    expect(got).toEqual([])
  })

  it('ignore les messages binaires (l’API n’envoie que du texte)', async () => {
    const game = await fakeGame()
    const conn = connection(game.port)
    const got: string[] = []
    conn.onFrame((f) => got.push(f.raw))
    conn.start()
    await waitFor(() => conn.status === 'connected')

    game.wss.clients.forEach((c: WebSocket) => c.send(Buffer.from([1, 2, 3]), { binary: true }))
    game.broadcast('texte')
    await waitFor(() => got.length === 1)
    expect(got).toEqual(['texte'])
  })
})
