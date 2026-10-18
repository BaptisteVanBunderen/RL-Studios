import type { PlayerState, TeamScore } from './events'

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
