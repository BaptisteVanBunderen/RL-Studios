import { z } from 'zod'

const guid = z.string().default('')

const playerRef = z.looseObject({
  Name: z.string(),
  Shortcut: z.number(),
  TeamNum: z.number()
})

const playerState = z.looseObject({
  Name: z.string(),
  PrimaryId: z.string(),
  Shortcut: z.number(),
  TeamNum: z.number(),
  Score: z.number().default(0),
  Goals: z.number().default(0),
  Shots: z.number().default(0),
  Assists: z.number().default(0),
  Saves: z.number().default(0),
  Demos: z.number().default(0)
})

const team = z.looseObject({
  Name: z.string(),
  TeamNum: z.number(),
  Score: z.number()
})

export const updateStateSchema = z.looseObject({
  MatchGuid: guid,
  Players: z.array(playerState).default([]),
  Game: z.looseObject({
    Teams: z.array(team).default([]),
    PlaylistId: z.number().optional(),
    TimeSeconds: z.number().default(0),
    bOvertime: z.boolean().default(false),
    bReplay: z.boolean().default(false),
    Frame: z.number().optional(),
    Target: playerRef.optional()
  })
})

export const clockSchema = z.looseObject({
  MatchGuid: guid,
  TimeSeconds: z.number(),
  bOvertime: z.boolean().default(false)
})

export const goalScoredSchema = z.looseObject({
  MatchGuid: guid,
  GoalSpeed: z.number().default(0),
  GoalTime: z.number().default(0),
  Scorer: playerRef,
  Assister: playerRef.optional()
})

export const matchEndedSchema = z.looseObject({
  MatchGuid: guid,
  WinnerTeamNum: z.number()
})

export const statfeedSchema = z.looseObject({
  MatchGuid: guid,
  EventName: z.string(),
  Type: z.string().default(''),
  MainTarget: playerRef.optional(),
  SecondaryTarget: playerRef.optional()
})

export const crossbarHitSchema = z.looseObject({
  MatchGuid: guid,
  BallSpeed: z.number().default(0),
  ImpactForce: z.number(),
  BallLastTouch: z.looseObject({ Player: playerRef.optional() }).optional()
})

export const playerPresenceSchema = z.looseObject({
  MatchGuid: guid,
  PlayerName: z.string(),
  PrimaryId: z.string()
})

export const matchGuidOnlySchema = z.looseObject({ MatchGuid: guid })

export const replayCreatedSchema = z.looseObject({
  FileName: z.string(),
  Date: z.string().default('')
})
