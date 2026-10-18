import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { StatsPipeline, type OverlayMessage, type SessionState } from '@core/index'
import { loadCapture } from '@core/test-utils/loadCapture'
import { GameConnection, ReplaySource } from '@game/index'
import { OverlayServer } from './OverlayServer'

/**
 * Chaîne complète, comme dans l'application :
 *   source de trames → StatsPipeline → OverlayServer → un overlay (client WebSocket)
 * La source est soit un rejeu de capture, soit une vraie connexion WebSocket vers un faux jeu.
 */

const toStatus = {
  connected: 'connected',
  disconnected: 'game-closed' // la distinction « api-disabled » viendra de la P5
} as const

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor : délai dépassé')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('chaîne complète : trames → pipeline → serveur → overlay', () => {
  const cleanups: (() => void | Promise<void>)[] = []
  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn()
  })

  async function startOverlayServer(): Promise<OverlayServer> {
    const server = new OverlayServer({ port: 0, matchIntervalMs: 10 })
    await server.start()
    cleanups.push(() => server.stop())
    return server
  }

  /** Branche un pipeline sur le serveur, comme le fera le processus principal. */
  function wire(server: OverlayServer): StatsPipeline {
    const pipeline = new StatsPipeline({
      onMatch: (m) => server.publish('match', m),
      onSession: (s) => server.publish('session', s),
      onEvent: (e) => server.publish('event', e)
    })
    server.publish('session', pipeline.session) // valeur initiale pour les overlays qui arrivent
    return pipeline
  }

  async function overlay(server: OverlayServer): Promise<OverlayMessage[]> {
    const messages: OverlayMessage[] = []
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`)
    cleanups.push(() => ws.terminate())
    ws.on('message', (d) => messages.push(JSON.parse(d.toString())))
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('error', reject)
    })
    return messages
  }

  const lastSession = (messages: OverlayMessage[]): SessionState | undefined =>
    messages.findLast((m) => m.type === 'session')?.payload as SessionState | undefined

  it('rejeu de la session de 7 matchs : l’overlay voit la session se construire', async () => {
    const server = await startOverlayServer()
    const pipeline = wire(server)
    const messages = await overlay(server)

    const source = await ReplaySource.fromFile('captures/2026-10-02_session-7-matchs-ff.jsonl.gz', {
      speed: Infinity
    })
    source.onFrame((f) => pipeline.feed(f.raw))
    source.start()

    await waitFor(() => lastSession(messages)?.losses === 4)
    expect(lastSession(messages)).toMatchObject({ wins: 3, losses: 4, streak: 1, bestStreak: 1 })

    // Une mise à jour de session par match compté (+ la valeur initiale à la connexion).
    const sessions = messages.filter((m) => m.type === 'session')
    expect(
      sessions.map((m) => (m.payload as SessionState).wins + (m.payload as SessionState).losses)
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7])

    // Les events ponctuels arrivent : fins de match, buts ; mais ni l'état périodique ni l'horloge.
    const eventTypes = new Set(
      messages.filter((m) => m.type === 'event').map((m) => (m.payload as { type: string }).type)
    )
    expect(eventTypes).toContain('matchEnded')
    expect(eventTypes).toContain('goal')
    expect(eventTypes).not.toContain('update')
    expect(eventTypes).not.toContain('clock')
  })

  it('replay d’historique : l’overlay ne reçoit ni but, ni résultat, ni état', async () => {
    const server = await startOverlayServer()
    const pipeline = wire(server)
    const messages = await overlay(server)

    const source = await ReplaySource.fromFile('captures/2026-10-01_replay-historique.jsonl.gz', {
      speed: Infinity
    })
    source.onFrame((f) => pipeline.feed(f.raw))
    source.start()
    await new Promise((r) => setTimeout(r, 100))

    // Seule la session initiale (à zéro) a été reçue.
    expect(messages.map((m) => m.type)).toEqual(['session'])
    expect(lastSession(messages)).toMatchObject({ wins: 0, losses: 0 })
  })

  it('un overlay qui se connecte en cours de route reçoit tout de suite l’état courant', async () => {
    const server = await startOverlayServer()
    const pipeline = wire(server)

    const source = await ReplaySource.fromFile('captures/2026-10-01_match-complet.jsonl.gz', {
      speed: Infinity
    })
    source.onFrame((f) => pipeline.feed(f.raw))
    source.start() // le match est déjà fini quand l'overlay arrive

    const late = await overlay(server)
    await waitFor(() => late.length >= 2)
    expect(lastSession(late)).toMatchObject({ wins: 1, lastResult: { won: true, playlistId: 2 } })
    expect(late.map((m) => m.type)).not.toContain('event') // jamais rejoué
  })

  it('avec une vraie connexion WebSocket vers un faux jeu', async () => {
    // Faux jeu : il envoie la capture complète dès qu'un client se connecte.
    const frames = loadCapture('2026-10-01_match-complet')
    const http: Server = createServer()
    const gameWss = new WebSocketServer({ server: http })
    gameWss.on('connection', (socket) => {
      for (const f of frames) socket.send(f.raw)
    })
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
    cleanups.push(async () => {
      for (const c of gameWss.clients) c.terminate()
      await new Promise<void>((resolve) => gameWss.close(() => resolve()))
      await new Promise<void>((resolve) => http.close(() => resolve()))
    })

    const server = await startOverlayServer()
    const pipeline = wire(server)
    const messages = await overlay(server)

    const connection = new GameConnection({
      port: (http.address() as AddressInfo).port,
      initialRetryDelayMs: 20,
      maxRetryDelayMs: 50
    })
    cleanups.push(() => connection.stop())
    connection.onStatus((s) => server.publish('connection', { status: toStatus[s] }))
    connection.onFrame((f) => pipeline.feed(f.raw))
    connection.start()

    await waitFor(() => lastSession(messages)?.wins === 1)
    expect(messages.some((m) => m.type === 'connection')).toBe(true)
    expect(messages.find((m) => m.type === 'connection')?.payload).toEqual({ status: 'connected' })
    expect(messages.some((m) => m.type === 'match')).toBe(true)
  })
})
