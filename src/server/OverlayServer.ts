import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import {
  PROTOCOL_VERSION,
  STATE_TOPICS,
  TOPIC_NAMES,
  isTopicName,
  type OverlayMessage,
  type TopicName,
  type TopicPayloads
} from '@core/index'
import { WebSocketServer, type WebSocket } from 'ws'
import { createThrottle, type Throttle } from './throttle'

export const DEFAULT_OVERLAY_PORT = 49200

export const OVERLAY_HOST = '127.0.0.1'

const MATCH_INTERVAL_MS = 1000 / 30

const MAX_BUFFERED_BYTES = 1024 * 1024

export interface OverlayServerOptions {
  port?: number
  matchIntervalMs?: number
}

export class OverlayServer {
  private readonly requestedPort: number
  private readonly matchInterval: number

  private http: Server | null = null
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 1024 })
  private readonly subscriptions = new Map<WebSocket, ReadonlySet<TopicName>>()
  private readonly latest = new Map<TopicName, unknown>()
  private matchThrottle: Throttle<unknown> | null = null

  constructor(options: OverlayServerOptions = {}) {
    this.requestedPort = options.port ?? DEFAULT_OVERLAY_PORT
    this.matchInterval = options.matchIntervalMs ?? MATCH_INTERVAL_MS
  }

  get port(): number {
    if (!this.http) throw new Error("Le serveur d'overlays n'est pas démarré")
    return (this.http.address() as AddressInfo).port
  }

  get isRunning(): boolean {
    return this.http !== null
  }

  get clientCount(): number {
    return this.subscriptions.size
  }

  async start(): Promise<void> {
    if (this.http) return

    const http = createServer((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Introuvable')
    })
    http.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head))

    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        reject(
          error.code === 'EADDRINUSE'
            ? new Error(`Le port ${this.requestedPort} est déjà utilisé (serveur d'overlays)`)
            : error
        )
      }
      http.once('error', onError)
      http.listen(this.requestedPort, OVERLAY_HOST, () => {
        http.off('error', onError)
        resolve()
      })
    })

    http.on('error', (error) => console.error("Serveur d'overlays : erreur", error))
    this.http = http
    this.matchThrottle = createThrottle(
      (payload) => this.broadcast('match', payload),
      this.matchInterval
    )
  }

  async stop(): Promise<void> {
    const http = this.http
    if (!http) return
    this.http = null
    this.matchThrottle?.cancel()
    this.matchThrottle = null

    for (const client of this.subscriptions.keys()) {
      client.close(1001, 'Arrêt de RL Studio')
      setTimeout(() => client.terminate(), 500).unref()
    }
    this.subscriptions.clear()

    await new Promise<void>((resolve) => http.close(() => resolve()))
  }

  publish<T extends TopicName>(topic: T, payload: TopicPayloads[T]): void {
    if ((STATE_TOPICS as readonly TopicName[]).includes(topic)) this.latest.set(topic, payload)

    if (topic === 'match' && this.matchThrottle) this.matchThrottle.push(payload)
    else this.broadcast(topic, payload)
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    socket.on('error', () => {})
    const url = new URL(req.url ?? '/', `http://${OVERLAY_HOST}`)

    if (url.pathname !== '/ws') return rejectUpgrade(socket, 404, 'Not Found')

    if (!this.isAllowedOrigin(req.headers.origin)) return rejectUpgrade(socket, 403, 'Forbidden')

    const topics = parseTopics(url.searchParams.get('topics'))
    if (topics === null) return rejectUpgrade(socket, 400, 'Bad Request')

    this.wss.handleUpgrade(req, socket, head, (client) => this.onConnection(client, topics))
  }

  private isAllowedOrigin(origin: string | undefined): boolean {
    if (origin === undefined) return true
    const port = this.port
    return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`
  }

  private onConnection(client: WebSocket, topics: ReadonlySet<TopicName>): void {
    this.subscriptions.set(client, topics)
    client.on('message', () => {})
    client.on('error', () => {})
    client.on('close', () => this.subscriptions.delete(client))

    for (const topic of STATE_TOPICS) {
      if (topics.has(topic) && this.latest.has(topic)) {
        send(client, encode(topic, this.latest.get(topic)))
      }
    }
  }

  private broadcast(topic: TopicName, payload: unknown): void {
    if (this.subscriptions.size === 0) return
    const message = encode(topic, payload)
    for (const [client, topics] of this.subscriptions) {
      if (!topics.has(topic)) continue
      if (topic === 'match' && client.bufferedAmount > MAX_BUFFERED_BYTES) continue
      send(client, message)
    }
  }
}

function encode(topic: TopicName, payload: unknown): string {
  const message = { v: PROTOCOL_VERSION, type: topic, payload } as OverlayMessage
  return JSON.stringify(message)
}

function send(client: WebSocket, message: string): void {
  if (client.readyState === client.OPEN) client.send(message)
}

function parseTopics(param: string | null): ReadonlySet<TopicName> | null {
  const requested = (param ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  if (requested.length === 0) return new Set(TOPIC_NAMES)

  const topics = new Set<TopicName>(['settings'])
  for (const name of requested) {
    if (!isTopicName(name)) return null
    topics.add(name)
  }
  return topics
}

function rejectUpgrade(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  socket.destroy()
}
