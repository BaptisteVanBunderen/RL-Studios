import { z } from 'zod'
import { parseEnvelope } from './envelope'
import type { GameEvent, PlayerRef, UpdateEvent } from './events'
import {
  clockSchema,
  crossbarHitSchema,
  goalScoredSchema,
  matchEndedSchema,
  matchGuidOnlySchema,
  playerPresenceSchema,
  replayCreatedSchema,
  statfeedSchema,
  updateStateSchema
} from './schemas'

type RawPlayerRef = { Name: string; Shortcut: number; TeamNum: number }

function toPlayerRef(p: RawPlayerRef): PlayerRef {
  return { name: p.Name, shortcut: p.Shortcut, teamNum: p.TeamNum }
}

function toOptionalPlayerRef(p: RawPlayerRef | undefined): PlayerRef | null {
  return p && p.Name.trim() !== '' ? toPlayerRef(p) : null
}

function toUpdate(d: z.infer<typeof updateStateSchema>): UpdateEvent {
  const players = d.Players.map((p) => ({
    ...toPlayerRef(p),
    primaryId: p.PrimaryId,
    score: p.Score,
    goals: p.Goals,
    shots: p.Shots,
    assists: p.Assists,
    saves: p.Saves,
    demos: p.Demos
  }))

  const rawTarget = d.Game.Target
  return {
    type: 'update',
    matchGuid: d.MatchGuid,
    playlistId: d.Game.PlaylistId ?? null,
    timeSeconds: d.Game.TimeSeconds,
    overtime: d.Game.bOvertime,
    isReplay: d.Game.bReplay,
    isHistoryReplay: d.Game.Frame !== undefined,
    teams: d.Game.Teams.map((t) => ({ teamNum: t.TeamNum, name: t.Name, score: t.Score })),
    players,
    target: rawTarget
      ? {
          ...toPlayerRef(rawTarget),
          primaryId: players.find((p) => p.shortcut === rawTarget.Shortcut)?.primaryId ?? null
        }
      : null
  }
}

export function normalize(raw: string): GameEvent | null {
  const envelope = parseEnvelope(raw)
  if (!envelope) return null
  const { event, data } = envelope

  switch (event) {
    case 'UpdateState': {
      const r = updateStateSchema.safeParse(data)
      return r.success ? toUpdate(r.data) : null
    }
    case 'ClockUpdatedSeconds': {
      const r = clockSchema.safeParse(data)
      return r.success
        ? {
            type: 'clock',
            matchGuid: r.data.MatchGuid,
            timeSeconds: r.data.TimeSeconds,
            overtime: r.data.bOvertime
          }
        : null
    }
    case 'GoalScored': {
      const r = goalScoredSchema.safeParse(data)
      if (!r.success) return null
      if (r.data.Scorer.Name.trim() === '') return null
      return {
        type: 'goal',
        matchGuid: r.data.MatchGuid,
        scorer: toPlayerRef(r.data.Scorer),
        assister: toOptionalPlayerRef(r.data.Assister),
        goalSpeed: r.data.GoalSpeed,
        goalTime: r.data.GoalTime
      }
    }
    case 'MatchEnded': {
      const r = matchEndedSchema.safeParse(data)
      return r.success
        ? { type: 'matchEnded', matchGuid: r.data.MatchGuid, winnerTeamNum: r.data.WinnerTeamNum }
        : null
    }
    case 'StatfeedEvent': {
      const r = statfeedSchema.safeParse(data)
      return r.success
        ? {
            type: 'statfeed',
            matchGuid: r.data.MatchGuid,
            name: r.data.EventName,
            label: r.data.Type,
            mainTarget: toOptionalPlayerRef(r.data.MainTarget),
            secondaryTarget: toOptionalPlayerRef(r.data.SecondaryTarget)
          }
        : null
    }
    case 'CrossbarHit': {
      const r = crossbarHitSchema.safeParse(data)
      if (!r.success || r.data.ImpactForce <= 0) return null
      return {
        type: 'crossbarHit',
        matchGuid: r.data.MatchGuid,
        ballSpeed: r.data.BallSpeed,
        impactForce: r.data.ImpactForce,
        lastTouch: toOptionalPlayerRef(r.data.BallLastTouch?.Player)
      }
    }
    case 'PlayerJoined':
    case 'PlayerLeft': {
      const r = playerPresenceSchema.safeParse(data)
      return r.success
        ? {
            type: event === 'PlayerJoined' ? 'playerJoined' : 'playerLeft',
            matchGuid: r.data.MatchGuid,
            playerName: r.data.PlayerName,
            primaryId: r.data.PrimaryId
          }
        : null
    }
    case 'MatchCreated':
    case 'MatchDestroyed': {
      const r = matchGuidOnlySchema.safeParse(data)
      return r.success
        ? {
            type: event === 'MatchCreated' ? 'matchCreated' : 'matchDestroyed',
            matchGuid: r.data.MatchGuid
          }
        : null
    }
    case 'ReplayCreated': {
      const r = replayCreatedSchema.safeParse(data)
      return r.success
        ? { type: 'replayCreated', fileName: r.data.FileName, date: r.data.Date }
        : null
    }
    default:
      return null
  }
}
