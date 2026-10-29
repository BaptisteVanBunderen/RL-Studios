import type { ClockEvent, GameEvent, ReplayCreatedEvent, UpdateEvent } from './events'
import type { MatchState } from './match'
import type { SessionState } from './session'

/** Version du protocole overlay ↔ RL Studio (champ `v` de chaque message). */
export const PROTOCOL_VERSION = 1

/**
 * `game-closed` : processus du jeu absent. `api-disabled` : jeu lancé mais port 49124 injoignable.
 * `connected` : connexion WebSocket établie.
 */
export type ConnectionStatus = 'game-closed' | 'api-disabled' | 'connected'

/**
 * Events transmis aux overlays (topic `event`) : tout sauf l'état périodique (→ topic `match`),
 * l'horloge (incluse dans `match`) et `replayCreated` (interne).
 */
export type OverlayEvent = Exclude<GameEvent, UpdateEvent | ClockEvent | ReplayCreatedEvent>

export function isOverlayEvent(event: GameEvent): event is OverlayEvent {
  return event.type !== 'update' && event.type !== 'clock' && event.type !== 'replayCreated'
}

/** Contenu de chaque topic. */
export interface TopicPayloads {
  /** Valeurs des réglages du module (P4). */
  settings: Record<string, unknown>
  session: SessionState
  /** `null` entre deux matchs. */
  match: MatchState | null
  /** Flux d'events ponctuels (but, fin de match…). */
  event: OverlayEvent
  connection: { status: ConnectionStatus }
}

export type TopicName = keyof TopicPayloads

export const TOPIC_NAMES: readonly TopicName[] = [
  'settings',
  'session',
  'match',
  'event',
  'connection'
]

/**
 * Topics d'état globaux : le serveur mémorise la dernière valeur et la renvoie à la connexion.
 * `settings` n'en fait pas partie : il est propre à chaque module (voir OverlayServer).
 */
export const STATE_TOPICS: readonly TopicName[] = ['session', 'match', 'connection']

/** Topics que le serveur publie globalement (tous sauf `settings`, propre à chaque module). */
export type PublishableTopic = Exclude<TopicName, 'settings'>

/** Message sur le fil : `{ "v": 1, "type": "<topic>", "payload": { ... } }`. */
export interface OverlayMessage<T extends TopicName = TopicName> {
  v: typeof PROTOCOL_VERSION
  type: T
  payload: TopicPayloads[T]
}

export function isTopicName(value: string): value is TopicName {
  return (TOPIC_NAMES as readonly string[]).includes(value)
}
