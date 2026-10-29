import type { PlayerState, TeamScore } from './events'

/** Statistiques du joueur local : sur un match, ou cumulées sur la session. */
export interface MatchStats {
  goals: number
  assists: number
  saves: number
  shots: number
  /** Démolitions faites. */
  demos: number
  /** Démolitions subies (events `Demolish` dont le joueur local est la cible). */
  demosTaken: number
}

export interface MatchState {
  matchGuid: string
  playlistId: number | null
  status: 'inProgress' | 'ended'
  timeSeconds: number
  overtime: boolean
  isReplay: boolean
  teams: TeamScore[]
  players: PlayerState[]
  localPlayerId: string | null
  myTeamNum: number | null
  winnerTeamNum: number | null
  /** Vitesse actuelle de la balle (km/h). */
  ballSpeed: number
  /** Plus grande vitesse de balle vue depuis le début du match (hors replays de but). */
  maxBallSpeed: number
  /** Démolitions subies par le joueur local depuis le début du match. */
  demosTaken: number
}

export type ResultKind = 'matchEnded' | 'statfeed' | 'abandon'

export interface MatchResult {
  matchGuid: string
  won: boolean
  playlistId: number | null
  kind: ResultKind
  myTeamNum: number | null
  winnerTeamNum: number | null
}
