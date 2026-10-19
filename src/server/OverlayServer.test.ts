import { connect as netConnect } from 'node:net'
import { networkInterfaces } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { MatchState, OverlayMessage, SessionState } from '@core/index'
import { OverlayServer } from './OverlayServer'

// ---------------------------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------------------------

interface Client {
  ws: WebSocket
  messages: OverlayMessage[]
  /** Types reçus, dans l'ordre. */
  types: () => string[]
}

const clients: WebSocket[] = []

/** Ouvre un client et attend l'ouverture. `headers` sert à simuler un navigateur (Origin). */
async function open(
  port: number,
  query = '',
  headers: Record<string, string> = {}
): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`, { headers })
  clients.push(ws)
  const messages: OverlayMessage[] = []
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())))
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
  return { ws, messages, types: () => messages.map((m) => m.type) }
}

/** Tente une connexion qui doit être refusée ; renvoie le code HTTP de la réponse. */
function rejected(url: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers })
    ws.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0)
      ws.terminate()
    })
    ws.once('open', () => reject(new Error('connexion acceptée alors qu’elle devait être refusée')))
    ws.once('error', () => {})
  })
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor : délai dépassé')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const session = (wins: number): SessionState => ({
  wins,
  losses: 0,
  streak: wins,
  bestStreak: wins,
  lastResult: { won: true, playlistId: 2 }
})

const match = (timeSeconds: number): MatchState => ({
  matchGuid: 'G1',
  playlistId: 2,
  status: 'inProgress',
  timeSeconds,
  overtime: false,
  isReplay: false,
  teams: [],
  players: [],
  localPlayerId: null,
  myTeamNum: null,
  winnerTeamNum: null
})

// ---------------------------------------------------------------------------------------------

describe('OverlayServer', () => {
  let server: OverlayServer

  beforeEach(async () => {
    server = new OverlayServer({ port: 0, matchIntervalMs: 50 })
    await server.start()
  })

  afterEach(async () => {
    for (const ws of clients.splice(0)) ws.terminate()
    await server.stop()
  })

  describe('protocole', () => {
    it('les messages ont la forme { v: 1, type, payload }', async () => {
      const c = await open(server.port, '?topics=session')
      server.publish('session', session(1))
      await waitFor(() => c.messages.length === 1)
      expect(c.messages[0]).toEqual({ v: 1, type: 'session', payload: session(1) })
    })

    it('un client reçoit les publications suivantes en direct', async () => {
      const c = await open(server.port, '?topics=session')
      server.publish('session', session(1))
      server.publish('session', session(2))
      await waitFor(() => c.messages.length === 2)
      expect(c.messages.map((m) => (m.payload as SessionState).wins)).toEqual([1, 2])
    })

    it('ignore ce que les overlays envoient (pas de commandes en v1)', async () => {
      const c = await open(server.port, '?topics=session')
      c.ws.send('{"commande":"reset"}')
      c.ws.send('pas du json')
      await sleep(30)
      server.publish('session', session(1))
      await waitFor(() => c.messages.length === 1)
      expect(c.ws.readyState).toBe(WebSocket.OPEN)
    })
  })

  describe('état courant à la connexion', () => {
    it('envoie la dernière valeur connue de chaque topic d’état demandé, dans un ordre stable', async () => {
      server.publish('connection', { status: 'connected' })
      server.publish('match', match(100))
      server.publish('session', session(2))
      await sleep(10)

      const c = await open(server.port)
      await waitFor(() => c.messages.length === 3)
      expect(c.types()).toEqual(['session', 'match', 'connection'])
      expect(c.messages[0].payload).toEqual(session(2))
    })

    it('ne renvoie que les topics demandés', async () => {
      server.publish('session', session(1))
      server.publish('match', match(1))
      server.publish('connection', { status: 'connected' })
      await sleep(10)

      const c = await open(server.port, '?topics=session')
      await waitFor(() => c.messages.length === 1)
      await sleep(30)
      expect(c.types()).toEqual(['session'])
    })

    it('ne rejoue JAMAIS le flux d’events (un overlay ne doit pas revoir un vieux but)', async () => {
      server.publish('event', { type: 'matchCreated', matchGuid: 'G1' })
      server.publish('session', session(1))
      await sleep(10)

      const c = await open(server.port)
      await waitFor(() => c.messages.length >= 1)
      await sleep(30)
      expect(c.types()).toEqual(['session'])
    })

    it('« plus de match » (null) est une valeur d’état à part entière', async () => {
      server.publish('match', null)
      await sleep(10)
      const c = await open(server.port, '?topics=match')
      await waitFor(() => c.messages.length === 1)
      expect(c.messages[0]).toEqual({ v: 1, type: 'match', payload: null })
    })

    it('ne renvoie rien pour un topic jamais publié', async () => {
      const c = await open(server.port)
      await sleep(40)
      expect(c.messages).toEqual([])
    })
  })

  describe('abonnements', () => {
    it('chaque client ne reçoit que ses topics', async () => {
      const onlySession = await open(server.port, '?topics=session')
      const onlyEvents = await open(server.port, '?topics=event')
      server.publish('session', session(1))
      server.publish('event', { type: 'matchCreated', matchGuid: 'G1' })
      await waitFor(() => onlySession.messages.length === 1 && onlyEvents.messages.length === 1)
      await sleep(30)
      expect(onlySession.types()).toEqual(['session'])
      expect(onlyEvents.types()).toEqual(['event'])
    })

    it('un topic inconnu est refusé (400) pour révéler les fautes de frappe', async () => {
      expect(await rejected(`ws://127.0.0.1:${server.port}/ws?topics=sesion`)).toBe(400)
    })

    it('compte les clients connectés et déconnectés', async () => {
      expect(server.clientCount).toBe(0)
      const a = await open(server.port)
      await open(server.port)
      await waitFor(() => server.clientCount === 2)
      a.ws.close()
      await waitFor(() => server.clientCount === 1)
    })
  })

  describe('limite de débit du topic match', () => {
    it('une rafale ne produit que quelques messages et la dernière valeur arrive toujours', async () => {
      const c = await open(server.port, '?topics=match')
      for (let i = 1; i <= 50; i++) server.publish('match', match(i))

      await waitFor(
        () => (c.messages.at(-1)?.payload as MatchState | undefined)?.timeSeconds === 50
      )
      expect(c.messages.length).toBeLessThanOrEqual(3)
      expect((c.messages[0].payload as MatchState).timeSeconds).toBe(1) // premier : immédiat
    })

    it('un client qui se connecte pendant la limitation reçoit déjà la valeur la plus récente', async () => {
      server.publish('match', match(1))
      server.publish('match', match(2))
      server.publish('match', match(3)) // en attente dans le throttle
      const c = await open(server.port, '?topics=match')
      await waitFor(() => c.messages.length >= 1)
      expect((c.messages[0].payload as MatchState).timeSeconds).toBe(3)
    })

    it('les autres topics ne sont pas limités', async () => {
      const c = await open(server.port, '?topics=session')
      for (let i = 1; i <= 10; i++) server.publish('session', session(i))
      await waitFor(() => c.messages.length === 10)
    })
  })

  describe('sécurité', () => {
    it('refuse tout chemin autre que /ws', async () => {
      expect(await rejected(`ws://127.0.0.1:${server.port}/autre`)).toBe(404)
      expect(await rejected(`ws://127.0.0.1:${server.port}/`)).toBe(404)
    })

    it('refuse la page web d’un autre site (Origin étranger)', async () => {
      const url = `ws://127.0.0.1:${server.port}/ws`
      expect(await rejected(url, { Origin: 'https://site-malveillant.example' })).toBe(403)
      expect(await rejected(url, { Origin: 'null' })).toBe(403)
      // Même hôte mais mauvais port : c'est un autre service local.
      expect(await rejected(url, { Origin: 'http://127.0.0.1:1' })).toBe(403)
    })

    it('accepte les pages servies par le serveur lui-même, et les clients sans Origin', async () => {
      const port = server.port
      await open(port, '', { Origin: `http://127.0.0.1:${port}` })
      await open(port, '', { Origin: `http://localhost:${port}` })
      await open(port)
      await waitFor(() => server.clientCount === 3)
    })

    it('répond 404 en HTTP simple (les routes des packs viennent en P2)', async () => {
      const res = await fetch(`http://127.0.0.1:${server.port}/`)
      expect(res.status).toBe(404)
    })

    const external = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal)?.address

    it.skipIf(!external)(
      'n’écoute QUE sur 127.0.0.1 : refusé depuis l’adresse réseau de la machine',
      async () => {
        const outcome = await new Promise<string>((resolve) => {
          const socket = netConnect({ host: external, port: server.port })
          socket.once('connect', () => {
            socket.destroy()
            resolve('connecté')
          })
          socket.once('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? 'erreur'))
        })
        expect(outcome).toBe('ECONNREFUSED')
      }
    )
  })

  describe('cycle de vie', () => {
    it('expose le port réellement utilisé', () => {
      expect(server.port).toBeGreaterThan(0)
      expect(server.isRunning).toBe(true)
    })

    it('start() deux fois est sans effet, stop() deux fois aussi', async () => {
      const port = server.port
      await server.start()
      expect(server.port).toBe(port)
      await server.stop()
      await server.stop()
      expect(server.isRunning).toBe(false)
      expect(() => server.port).toThrow('pas démarré')
    })

    it('stop() ferme les clients et plus personne ne peut se connecter', async () => {
      const port = server.port
      const c = await open(port)
      const closed = new Promise<number>((resolve) => c.ws.once('close', (code) => resolve(code)))
      await server.stop()
      expect(await closed).toBe(1001)
      await expect(open(port)).rejects.toThrow()
    })

    it('publier sans client, ou après l’arrêt, ne plante pas', async () => {
      server.publish('session', session(1))
      await server.stop()
      expect(() => server.publish('match', match(1))).not.toThrow()
    })

    it('port déjà pris : erreur claire en français', async () => {
      const other = new OverlayServer({ port: server.port })
      await expect(other.start()).rejects.toThrow(`Le port ${server.port} est déjà utilisé`)
      expect(other.isRunning).toBe(false)
    })

    it('peut être redémarré après un arrêt', async () => {
      await server.stop()
      await server.start()
      const c = await open(server.port, '?topics=session')
      server.publish('session', session(1))
      await waitFor(() => c.messages.length === 1)
    })
  })
})
