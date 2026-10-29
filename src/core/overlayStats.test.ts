import { describe, expect, it } from 'vitest'
import { StatsPipeline } from './pipeline'
import { emptySession, type SessionState, type SessionStats } from './session'
import { loadCapture } from './test-utils/loadCapture'

// Les statistiques de session s'additionnent au fil de la partie : chaque tir, but, passe, arrêt
// ou démolition s'ajoute dès qu'il se produit. Les overlays n'ont donc qu'à afficher
// `session.stats` : pas de fusion avec le match en cours, donc rien à doubler ni à perdre.

const KEYS: (keyof SessionStats)[] = ['shots', 'goals', 'assists', 'saves', 'demos', 'demosTaken']
const CAPTURES = ['2026-10-02_session-7-matchs-ff', '2026-10-01_match-complet']

function run(frames: { raw: string }[], extra: string[] = []): SessionState[] {
  const sessions: SessionState[] = [emptySession()]
  const pipeline = new StatsPipeline({ onSession: (s) => sessions.push(s) })
  for (const frame of frames) pipeline.feed(frame.raw)
  for (const raw of extra) pipeline.feed(raw)
  return sessions
}

describe('session.stats s’additionne en direct', () => {
  for (const name of CAPTURES) {
    it(`${name} : les totaux ne baissent jamais (replays de but compris)`, () => {
      const sessions = run(loadCapture(name))
      for (let i = 1; i < sessions.length; i++) {
        for (const key of KEYS) {
          expect(sessions[i].stats[key], `${key} à la mise à jour ${i}`).toBeGreaterThanOrEqual(
            sessions[i - 1].stats[key]
          )
        }
      }
    })

    it(`${name} : un total n'augmente que par ajouts (jamais de saut en arrière puis en avant)`, () => {
      const sessions = run(loadCapture(name))
      const finalShots = sessions.at(-1)!.stats.shots
      expect(finalShots).toBeGreaterThan(0)
      // aucune valeur intermédiaire ne dépasse le total final : rien n'est compté deux fois
      for (const s of sessions) expect(s.stats.shots).toBeLessThanOrEqual(finalShots)
    })
  }

  it('une trame tardive d’un match déjà terminé n’ajoute rien', () => {
    const frames = loadCapture('2026-10-01_match-complet')
    const lastUpdate = [...frames].reverse().find((f) => f.raw.includes('"UpdateState"'))!
    const normal = run(frames).at(-1)!
    const withLate = run(frames, [lastUpdate.raw]).at(-1)!
    expect(withLate.stats).toEqual(normal.stats)
  })

  it('le freeplay ne compte pas dans la session', () => {
    const final = run(loadCapture('2026-10-01_freeplay')).at(-1)!
    expect(final.stats).toEqual(emptySession().stats)
  })

  it('remettre la session à zéro en plein match ne recompte pas ce qui a déjà été fait', () => {
    const frames = loadCapture('2026-10-01_match-complet')
    const sessions: SessionState[] = []
    const pipeline = new StatsPipeline({ onSession: (s) => sessions.push(s) })

    const half = Math.floor(frames.length / 2)
    for (const frame of frames.slice(0, half)) pipeline.feed(frame.raw)
    const before = pipeline.session.stats
    pipeline.resetSession()
    expect(pipeline.session.stats).toEqual(emptySession().stats)
    for (const frame of frames.slice(half)) pipeline.feed(frame.raw)

    const whole = new StatsPipeline()
    for (const frame of frames) whole.feed(frame.raw)
    for (const key of KEYS) {
      expect(pipeline.session.stats[key]).toBe(whole.session.stats[key] - before[key])
    }
  })
})
