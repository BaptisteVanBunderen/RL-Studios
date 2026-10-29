import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MatchState } from './match'
import { StatsPipeline } from './pipeline'
import { emptySession } from './session'
import { loadCapture } from './test-utils/loadCapture'

// Les statistiques de session sont recalculées ici directement depuis les trames brutes (sans
// passer par normalize ni MatchTracker) : le test compare deux chemins indépendants.

const CAPTURE = '2026-10-02_session-7-matchs-ff'
const ME = 'Epic|ccbcafb466184042912a09790219276c|0'

interface Raw {
  Event: string
  Data: Record<string, unknown> & {
    MatchGuid?: string
    Players?: Record<string, unknown>[]
    Game?: { bReplay?: boolean; Ball?: { Speed: number } }
    SecondaryTarget?: { Name: string }
  }
}

function raws(name: string): Raw[] {
  return loadCapture(name).map((f) => {
    const m = JSON.parse(f.raw) as { Event: string; Data: unknown }
    return { Event: m.Event, Data: typeof m.Data === 'string' ? JSON.parse(m.Data) : m.Data } as Raw
  })
}

function countedGuids(): string[] {
  const file = resolve(process.cwd(), 'captures', `${CAPTURE}.matches.jsonl`)
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => (JSON.parse(l) as { guid: string }).guid)
}

describe('statistiques de session (capture des 7 matchs)', () => {
  const pipeline = new StatsPipeline()
  for (const frame of loadCapture(CAPTURE)) pipeline.feed(frame.raw)

  const guids = new Set(countedGuids())
  const frames = raws(CAPTURE)

  it('démolitions subies = events « Demolish » dont le joueur local est la cible', () => {
    const expected = frames.filter(
      (f) =>
        f.Event === 'StatfeedEvent' &&
        f.Data['EventName'] === 'Demolish' &&
        guids.has(f.Data.MatchGuid ?? '') &&
        f.Data.SecondaryTarget?.Name === 'THEVBAT'
    ).length
    expect(expected).toBeGreaterThan(0) // la capture contient bien des démolitions subies
    expect(pipeline.session.stats.demosTaken).toBe(expected)
  })

  it('buts, tirs, passes, arrêts et démolitions faites = dernières valeurs de chaque match', () => {
    const total = { goals: 0, shots: 0, assists: 0, saves: 0, demos: 0 }
    for (const guid of guids) {
      const last = frames
        .filter((f) => f.Event === 'UpdateState' && f.Data.MatchGuid === guid)
        .map((f) => f.Data.Players?.find((p) => p['PrimaryId'] === ME))
        .filter((p) => p !== undefined)
        .at(-1)
      if (!last) continue
      total.goals += Number(last['Goals'])
      total.shots += Number(last['Shots'])
      total.assists += Number(last['Assists'])
      total.saves += Number(last['Saves'])
      total.demos += Number(last['Demos'])
    }
    expect(pipeline.session.stats).toMatchObject(total)
    expect(total.shots).toBeGreaterThan(0)
  })

  it('remettre la session à zéro remet aussi les statistiques à zéro', () => {
    pipeline.resetSession()
    expect(pipeline.session).toEqual(emptySession())
  })
})

describe('vitesse de la balle', () => {
  it('le maximum du match = plus grande vitesse hors replay de but', () => {
    const states: MatchState[] = []
    const p = new StatsPipeline({ onMatch: (m) => m && states.push(m) })
    for (const frame of loadCapture('2026-10-01_match-complet')) p.feed(frame.raw)

    const expected = Math.max(
      ...raws('2026-10-01_match-complet')
        .filter((f) => f.Event === 'UpdateState' && !f.Data.Game?.bReplay)
        .map((f) => f.Data.Game?.Ball?.Speed ?? 0)
    )
    expect(expected).toBeGreaterThan(100)
    expect(Math.max(...states.map((s) => s.maxBallSpeed))).toBeCloseTo(expected, 6)

    // dans un même match, le maximum ne baisse jamais et reste au moins égal à la vitesse actuelle
    for (let i = 1; i < states.length; i++) {
      if (states[i].matchGuid === states[i - 1].matchGuid) {
        expect(states[i].maxBallSpeed).toBeGreaterThanOrEqual(states[i - 1].maxBallSpeed)
      }
    }
  })

  it('la vitesse de voiture et le boost du joueur local sont exposés', () => {
    const states: MatchState[] = []
    const p = new StatsPipeline({ onMatch: (m) => m && states.push(m) })
    for (const frame of loadCapture('2026-10-01_match-complet')) p.feed(frame.raw)
    const me = states.flatMap((s) => s.players.filter((pl) => pl.primaryId === s.localPlayerId))
    expect(me.some((pl) => pl.boost !== null && pl.boost >= 0 && pl.boost <= 100)).toBe(true)
    expect(me.some((pl) => pl.speed !== null && pl.speed > 0)).toBe(true)
  })
})
