import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import {
  DEFAULT_OVERLAY_PORT,
  PROTOCOL_VERSION,
  STATE_TOPICS,
  TOPIC_NAMES,
  isTopicName,
  parseModuleKey,
  type LoadedPack,
  type OverlayMessage,
  type PublishableTopic,
  type TopicName,
  type TopicPayloads
} from '@core/index'
import { WebSocketServer, type WebSocket } from 'ws'
import { createRequestHandler } from './routes'
import { createThrottle, type Throttle } from './throttle'

export { DEFAULT_OVERLAY_PORT }

/** Le serveur n'écoute JAMAIS ailleurs que sur la boucle locale : non configurable. */
export const OVERLAY_HOST = '127.0.0.1'

/** Le topic `match` est limité à 30 messages/s (l'API peut en envoyer jusqu'à 120/s). */
const MATCH_INTERVAL_MS = 1000 / 30

/** Au-delà, un client est trop lent : on lui saute des `match` plutôt que de gonfler la mémoire. */
const MAX_BUFFERED_BYTES = 1024 * 1024

/** Ce que le serveur doit savoir des packs : de quoi servir leurs fichiers et leurs réglages. */
export interface PackSource {
  getPack(id: string): LoadedPack | undefined
  /** Valeurs des réglages d'un module (défauts du manifeste + valeurs de l'utilisateur). */
  getSettings(packId: string, moduleId: string): Record<string, unknown>
}

export interface OverlayServerOptions {
  /** Port d'écoute. `0` = port libre choisi par l'OS (tests). Défaut : 49200. */
  port?: number
  /** Intervalle minimal entre deux messages `match`, en ms. Défaut : 1000 / 30. */
  matchIntervalMs?: number
  /** Packs servis à `/overlay/…`. Sans eux, le serveur ne sert que le WebSocket et le SDK. */
  packs?: PackSource
  /** Code du SDK servi à `/sdk/rlstudio.js`. */
  sdkSource?: string
}

interface Subscription {
  topics: ReadonlySet<TopicName>
  /** `<pack>/<module>` si le client s'est identifié (`?module=`), pour ses réglages. */
  moduleKey: string | null
}

/**
 * Serveur local des overlays : HTTP + WebSocket sur la même adresse (127.0.0.1 uniquement).
 *
 * HTTP : `/sdk/rlstudio.js`, `/overlay/<pack>/<module>` (page d'un module) et
 * `/overlay/<pack>/<fichier>` (voir routes.ts).
 *
 * WebSocket : `ws://127.0.0.1:<port>/ws?module=<pack>/<module>`. Les topics reçus sont ceux
 * du champ `data` du manifeste ; `?topics=a,b` les impose (outils de développement). Sans l'un ni
 * l'autre : tous les topics. `settings` est toujours envoyé, propre au module.
 *
 * À la connexion, le serveur envoie les réglages du module puis la dernière valeur connue de
 * chaque topic d'état demandé (`session`, `match`, `connection`). Le topic `event` est un flux
 * ponctuel : jamais rejoué (un overlay qui se connecte ne doit pas revoir un but vieux de dix
 * minutes).
 */
export class OverlayServer {
  private readonly requestedPort: number
  private readonly matchInterval: number
  private readonly packs: PackSource | undefined
  private readonly sdkSource: string

  private http: Server | null = null
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 1024 })
  private readonly subscriptions = new Map<WebSocket, Subscription>()
  /** Dernière valeur de chaque topic d'état, mise à jour à la publication sans attendre le throttle. */
  private readonly latest = new Map<TopicName, unknown>()
  private matchThrottle: Throttle<unknown> | null = null

  constructor(options: OverlayServerOptions = {}) {
    this.requestedPort = options.port ?? DEFAULT_OVERLAY_PORT
    this.matchInterval = options.matchIntervalMs ?? MATCH_INTERVAL_MS
    this.packs = options.packs
    this.sdkSource = options.sdkSource ?? ''
  }

  /** Port réellement utilisé (utile avec `port: 0`). */
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

    const http = createServer(
      createRequestHandler({
        getPack: (id) => this.packs?.getPack(id),
        sdkSource: this.sdkSource
      })
    )
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
      // Si le client ne répond pas à la fermeture, on coupe sec (sans retenir le processus).
      setTimeout(() => client.terminate(), 500).unref()
    }
    this.subscriptions.clear()

    // `close()` attendrait la fin des connexions HTTP en keep-alive (plusieurs secondes) : on les
    // coupe. Les WebSocket, sortis du suivi HTTP après la mise à niveau, sont fermés plus haut.
    const closed = new Promise<void>((resolve) => http.close(() => resolve()))
    http.closeAllConnections()
    await closed
  }

  /**
   * Publie une valeur sur un topic. Les topics d'état sont mémorisés pour les futures connexions.
   * `match` est limité en débit (la dernière valeur n'est jamais perdue).
   */
  publish<T extends PublishableTopic>(topic: T, payload: TopicPayloads[T]): void {
    if ((STATE_TOPICS as readonly TopicName[]).includes(topic)) this.latest.set(topic, payload)

    if (topic === 'match' && this.matchThrottle) this.matchThrottle.push(payload)
    else this.broadcast(topic, payload)
  }

  /** Envoie de nouveaux réglages aux overlays ouverts de ce module, sans rechargement. */
  publishSettings(moduleKey: string, values: Record<string, unknown>): void {
    const message = encode('settings', values)
    for (const [client, subscription] of this.subscriptions) {
      if (subscription.moduleKey === moduleKey) send(client, message)
    }
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    // Une coupure brutale du client pendant la poignée de main ne doit pas faire planter l'appli.
    socket.on('error', () => {})
    const url = new URL(req.url ?? '/', `http://${OVERLAY_HOST}`)

    if (url.pathname !== '/ws') return rejectUpgrade(socket, 404, 'Not Found')

    // Un site web quelconque peut ouvrir un WebSocket vers 127.0.0.1 depuis le navigateur de
    // l'utilisateur : on n'accepte que les pages servies par ce serveur (ou aucun Origin :
    // clients non navigateur).
    if (!this.isAllowedOrigin(req.headers.origin)) return rejectUpgrade(socket, 403, 'Forbidden')

    let moduleKey: string | null = null
    let moduleTopics: readonly TopicName[] | undefined
    const moduleParam = url.searchParams.get('module')
    if (moduleParam !== null) {
      const parsed = parseModuleKey(moduleParam)
      const module = parsed
        ? this.packs?.getPack(parsed.packId)?.manifest.modules.find((m) => m.id === parsed.moduleId)
        : undefined
      if (!module) return rejectUpgrade(socket, 404, 'Not Found')
      moduleKey = moduleParam
      moduleTopics = module.data
    }

    const topics = parseTopics(url.searchParams.get('topics'), moduleTopics)
    if (topics === null) return rejectUpgrade(socket, 400, 'Bad Request')

    this.wss.handleUpgrade(req, socket, head, (client) =>
      this.onConnection(client, { topics, moduleKey })
    )
  }

  private isAllowedOrigin(origin: string | undefined): boolean {
    if (origin === undefined) return true
    const port = this.port
    return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`
  }

  private onConnection(client: WebSocket, subscription: Subscription): void {
    this.subscriptions.set(client, subscription)
    // Les overlays n'envoient rien en v1 (le reset de session passe par le client) : on ignore.
    client.on('message', () => {})
    client.on('error', () => {})
    client.on('close', () => this.subscriptions.delete(client))

    const parsed = subscription.moduleKey ? parseModuleKey(subscription.moduleKey) : null
    if (parsed && this.packs) {
      send(client, encode('settings', this.packs.getSettings(parsed.packId, parsed.moduleId)))
    }

    // Dernière valeur connue de chaque topic d'état demandé, dans un ordre stable.
    for (const topic of STATE_TOPICS) {
      if (subscription.topics.has(topic) && this.latest.has(topic)) {
        send(client, encode(topic, this.latest.get(topic)))
      }
    }
  }

  private broadcast(topic: TopicName, payload: unknown): void {
    if (this.subscriptions.size === 0) return
    const message = encode(topic, payload)
    for (const [client, { topics }] of this.subscriptions) {
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

/**
 * `topics` explicite > topics du module (champ `data`) > tous. `settings` est toujours inclus.
 * Un nom inconnu → `null` (refus, pour révéler les fautes de frappe).
 */
function parseTopics(
  param: string | null,
  moduleTopics?: readonly TopicName[]
): ReadonlySet<TopicName> | null {
  const requested = (param ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  if (requested.length === 0) {
    return moduleTopics ? new Set<TopicName>(['settings', ...moduleTopics]) : new Set(TOPIC_NAMES)
  }

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
