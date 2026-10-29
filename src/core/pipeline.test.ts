import { describe, expect, it } from 'vitest'
import type { MatchState } from './match'
import { StatsPipeline } from './pipeline'
import type { OverlayEvent } from './protocol'
import { emptySession, type SessionState } from './session'
import { loadCapture } from './test-utils/loadCapture'

type Call =
  | { kind: 'match'; value: MatchState | null }
  | { kind: 'session'; value: SessionState }
  | { kind: 'event'; value: OverlayEvent }

/** Rejoue une capture dans une chaîne neuve en enregistrant tous les appels, dans l'ordre. */
function run(name: string): { pipeline: StatsPipeline; calls: Call[] } {
  const calls: Call[] = []
  const pipeline = new StatsPipeline({
    onMatch: (value) => calls.push({ kind: 'match', value }),
    onSession: (value) => calls.push({ kind: 'session', value }),
    onEvent: (value) => calls.push({ kind: 'event', value })
  })
  for (const frame of loadCapture(name)) pipeline.feed(frame.raw)
  return { pipeline, calls }
}

const eventTypes = (calls: Call[]): string[] =>
  calls.flatMap((c) => (c.kind === 'event' ? [c.value.type] : []))

describe('StatsPipeline', () => {
  it('match-complet : session à jour, état du match puis fin de match', () => {
    const { pipeline, calls } = run('2026-10-01_match-complet')
    expect(pipeline.session).toMatchObject({ wins: 1, losses: 0, streak: 1, bestStreak: 1 })
    expect(pipeline.session.lastResult).toEqual({ won: true, playlistId: 2 })
    expect(calls.some((c) => c.kind === 'match' && c.value?.status === 'ended')).toBe(true)
  })

  it('n’envoie aux overlays ni l’état périodique, ni l’horloge, ni les buts fantômes', () => {
    const { calls } = run('2026-10-01_match-complet')
    const types = eventTypes(calls)
    expect(types).not.toContain('update')
    expect(types).not.toContain('clock')
    expect(types).not.toContain('replayCreated')
    expect(types).toContain('goal')
    for (const c of calls) {
      if (c.kind === 'event' && c.value.type === 'goal') {
        expect(c.value.scorer.name).not.toBe('')
      }
    }
  })

  it('met la session à jour AVANT de transmettre matchEnded', () => {
    const { calls } = run('2026-10-01_match-complet')
    const endedAt = calls.findIndex((c) => c.kind === 'event' && c.value.type === 'matchEnded')
    const sessionAt = calls.findIndex((c) => c.kind === 'session')
    expect(sessionAt).toBeGreaterThanOrEqual(0)
    expect(sessionAt).toBeLessThan(endedAt)
  })

  it('diffuse « plus de match » (null) quand le match est détruit', () => {
    const { calls } = run('2026-10-01_match-complet')
    const nulls = calls.filter((c) => c.kind === 'match' && c.value === null)
    expect(nulls.length).toBeGreaterThan(0)
  })

  it('replay-historique : aucun effet (ni session, ni état, ni event)', () => {
    const { pipeline, calls } = run('2026-10-01_replay-historique')
    expect(calls).toEqual([])
    expect(pipeline.session).toMatchObject({ wins: 0, losses: 0, lastResult: null })
    expect(pipeline.match).toBeNull()
  })

  it('freeplay : l’état du match est diffusé mais la session reste vide', () => {
    const { pipeline, calls } = run('2026-10-01_freeplay')
    expect(calls.some((c) => c.kind === 'match')).toBe(true)
    expect(calls.some((c) => c.kind === 'session')).toBe(false)
    expect(pipeline.session.wins + pipeline.session.losses).toBe(0)
  })

  it('abandon : une défaite est comptée', () => {
    const { pipeline } = run('2026-10-01_abandon')
    expect(pipeline.session).toMatchObject({ wins: 0, losses: 1, streak: -1 })
  })

  it('session-7-matchs-ff : 3 victoires, 4 défaites', () => {
    const { pipeline } = run('2026-10-02_session-7-matchs-ff')
    expect(pipeline.session).toMatchObject({ wins: 3, losses: 4, streak: 1, bestStreak: 1 })
  })

  it('ignore les messages illisibles', () => {
    const calls: unknown[] = []
    const p = new StatsPipeline({ onMatch: (m) => calls.push(m), onEvent: (e) => calls.push(e) })
    p.feed('pas du json')
    p.feed('{}')
    expect(calls).toEqual([])
  })

  it('resetSession remet à zéro et prévient', () => {
    const { pipeline } = run('2026-10-01_match-complet')
    const seen: SessionState[] = []
    const p2 = new StatsPipeline({ onSession: (s) => seen.push(s) })
    p2.resetSession()
    expect(seen).toEqual([emptySession()])
    pipeline.resetSession()
    expect(pipeline.session.wins).toBe(0)
  })
})
