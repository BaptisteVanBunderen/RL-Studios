export interface PlayerRef {
  name: string
  shortcut: number
  teamNum: number
}

export interface PlayerState extends PlayerRef {
  primaryId: string
  score: number
  goals: number
  shots: number
  assists: number
  saves: number
  demos: number
}

export interface TeamScore {
  teamNum: number
  name: string
  score: number
}

export interface TargetPlayer extends PlayerRef {
  primaryId: string | null
}

export interface UpdateEvent {
  type: 'update'
  matchGuid: string
  playlistId: number | null
  timeSeconds: number
  overtime: boolean
  isReplay: boolean
  isHistoryReplay: boolean
  teams: TeamScore[]
  players: PlayerState[]
  target: TargetPlayer | null
}

export interface ClockEvent {
  type: 'clock'
  matchGuid: string
  timeSeconds: number
  overtime: boolean
}

export interface GoalEvent {
  type: 'goal'
  matchGuid: string
  scorer: PlayerRef
  assister: PlayerRef | null
  goalSpeed: number
  goalTime: number
}

export interface MatchEndedEvent {
  type: 'matchEnded'
  matchGuid: string
  winnerTeamNum: number
}

export interface StatfeedEvent {
  type: 'statfeed'
  matchGuid: string
  name: string
  label: string
  mainTarget: PlayerRef | null
  secondaryTarget: PlayerRef | null
}

export interface CrossbarHitEvent {
  type: 'crossbarHit'
  matchGuid: string
  ballSpeed: number
  impactForce: number
  lastTouch: PlayerRef | null
}

export interface PlayerJoinedEvent {
  type: 'playerJoined'
  matchGuid: string
  playerName: string
  primaryId: string
}

export interface PlayerLeftEvent {
  type: 'playerLeft'
  matchGuid: string
  playerName: string
  primaryId: string
}

export interface MatchCreatedEvent {
  type: 'matchCreated'
  matchGuid: string
}

export interface MatchDestroyedEvent {
  type: 'matchDestroyed'
  matchGuid: string
}

export interface ReplayCreatedEvent {
  type: 'replayCreated'
  fileName: string
  date: string
}

export type GameEvent =
  | UpdateEvent
  | ClockEvent
  | GoalEvent
  | MatchEndedEvent
  | StatfeedEvent
  | CrossbarHitEvent
  | PlayerJoinedEvent
  | PlayerLeftEvent
  | MatchCreatedEvent
  | MatchDestroyedEvent
  | ReplayCreatedEvent

export type GameEventType = GameEvent['type']
