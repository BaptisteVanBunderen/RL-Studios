import { describe, expect, it } from 'vitest'
import { createCrossbarDedupe } from './dedupe'
import { parseEnvelope } from './envelope'
import type { CrossbarHitEvent, GameEvent } from './events'
import { parseCaptureText } from './frames'
import { normalize } from './normalize'
import { CAPTURES, loadCapture } from './test-utils/loadCapture'

/** Fabrique un message brut tel que l'envoie le jeu (Data = string JSON). */
function msg(event: string, data: unknown): string {
  return JSON.stringify({ Event: event, Data: JSON.stringify(data) })
}

/** Normalise toute une capture (sans dédoublonnage) et compte les events bruts. */
function run(name: string): { events: GameEvent[]; rawCount: (event: string) => number } {
  const frames = loadCapture(name)
  const events: GameEvent[] = []
  const raw: Record<string, number> = {}
  for (const frame of frames) {
    const envelope = parseEnvelope(frame.raw)
    if (envelope) raw[envelope.event] = (raw[envelope.event] ?? 0) + 1
    const event = normalize(frame.raw)
    if (event) events.push(event)
  }
  return { events, rawCount: (e) => raw[e] ?? 0 }
}

describe('captures de référence', () => {
  it.each(CAPTURES)('%s : les trames sont monotones et tous les messages sont lisibles', (name) => {
    const frames = loadCapture(name)
    expect(frames.length).toBeGreaterThan(0)
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].t).toBeGreaterThanOrEqual(frames[i - 1].t)
    }
    expect(frames.filter((f) => parseEnvelope(f.raw) === null)).toEqual([])
  })

  it.each(CAPTURES)('%s : aucun UpdateState n’est perdu par les schémas', (name) => {
    const { events, rawCount } = run(name)
    expect(events.filter((e) => e.type === 'update')).toHaveLength(rawCount('UpdateState'))
  })

  it.each(CAPTURES)('%s : aucun but fantôme, et jamais d’ImpactLocation', (name) => {
    const { events } = run(name)
    for (const e of events) {
      if (e.type !== 'goal') continue
      expect(e.scorer.name.trim()).not.toBe('')
      expect(e).not.toHaveProperty('impactLocation')
    }
  })
})

describe('match-complet', () => {
  const { events, rawCount } = run('2026-10-01_match-complet')

  it('un seul matchEnded, gagné par l’équipe 1', () => {
    const ended = events.filter((e) => e.type === 'matchEnded')
    expect(ended).toHaveLength(1)
    expect(ended[0]).toMatchObject({ winnerTeamNum: 1 })
  })

  it('les buts fantômes sont filtrés (il y en a dans la capture brute)', () => {
    const goals = events.filter((e) => e.type === 'goal')
    expect(goals.length).toBeGreaterThan(0)
    expect(goals.length).toBeLessThan(rawCount('GoalScored'))
  })

  it('le joueur local THEVBAT est retrouvé avec son PrimaryId', () => {
    const targets = events.flatMap((e) => (e.type === 'update' && e.target ? [e.target] : []))
    const me = targets.find((t) => t.name === 'THEVBAT')
    expect(me).toBeDefined()
    expect(me?.teamNum).toBe(1)
    expect(me?.primaryId).toMatch(/^Epic\|/)
  })

  it('le score de référence vient de Game.Teams', () => {
    const last = events.filter((e) => e.type === 'update').at(-1)
    expect(last?.type === 'update' && last.teams).toHaveLength(2)
  })
})

describe('autres captures', () => {
  it('abandon : aucun matchEnded', () => {
    const { events } = run('2026-10-01_abandon')
    expect(events.some((e) => e.type === 'matchEnded')).toBe(false)
    expect(events.some((e) => e.type === 'matchDestroyed')).toBe(true)
  })

  it('prive-admin : matchEnded gagné par l’équipe 1', () => {
    const { events } = run('2026-10-01_prive-admin')
    expect(events.filter((e) => e.type === 'matchEnded')).toMatchObject([{ winnerTeamNum: 1 }])
  })

  it('freeplay : PlaylistId 9', () => {
    const updates = run('2026-10-01_freeplay').events.filter((e) => e.type === 'update')
    expect(updates.length).toBeGreaterThan(0)
    for (const u of updates) expect(u.playlistId).toBe(9)
  })

  it('replay-historique : replay détecté par Game.Frame', () => {
    const { events } = run('2026-10-01_replay-historique')
    expect(events.some((e) => e.type === 'replayCreated')).toBe(true)
    const history = events.filter((e) => e.type === 'update' && e.isHistoryReplay)
    expect(history.length).toBeGreaterThan(0)
  })
})

describe('CrossbarHit', () => {
  const { events } = run('2026-10-01_match-complet')
  const crossbars = events.filter((e): e is CrossbarHitEvent => e.type === 'crossbarHit')

  it('seuls les impacts de force positive passent', () => {
    for (const c of crossbars) expect(c.impactForce).toBeGreaterThan(0)
  })

  it('après dédoublonnage, deux CrossbarHit identiques ne se suivent jamais', () => {
    const dedupe = createCrossbarDedupe()
    const kept = events
      .map((e) => dedupe(e))
      .filter((e): e is CrossbarHitEvent => e?.type === 'crossbarHit')
    expect(kept.length).toBeLessThanOrEqual(crossbars.length)
    for (let i = 1; i < kept.length; i++) {
      const same =
        kept[i].impactForce === kept[i - 1].impactForce &&
        kept[i].ballSpeed === kept[i - 1].ballSpeed
      expect(same).toBe(false)
    }
  })
})

describe('normalize : cas isolés', () => {
  it('ignore les messages illisibles et les types non gérés', () => {
    expect(normalize('pas du json')).toBeNull()
    expect(normalize('42')).toBeNull()
    expect(normalize(JSON.stringify({ Data: '{}' }))).toBeNull()
    expect(normalize(msg('BallHit', { MatchGuid: 'x' }))).toBeNull()
  })

  it('ignore un event qui ne respecte pas son schéma', () => {
    expect(normalize(msg('MatchEnded', { MatchGuid: 'x' }))).toBeNull()
  })

  it('tolère un champ inconnu', () => {
    const e = normalize(msg('MatchEnded', { MatchGuid: 'x', WinnerTeamNum: 0, Nouveau: 1 }))
    expect(e).toEqual({ type: 'matchEnded', matchGuid: 'x', winnerTeamNum: 0 })
  })

  it('filtre un but dont le scorer est vide, garde un vrai but', () => {
    const scorer = (Name: string): object => ({ Name, Shortcut: 1, TeamNum: 0 })
    expect(normalize(msg('GoalScored', { MatchGuid: 'x', Scorer: scorer('') }))).toBeNull()
    expect(
      normalize(msg('GoalScored', { MatchGuid: 'x', Scorer: scorer('A'), Assister: scorer('') }))
    ).toMatchObject({ type: 'goal', scorer: { name: 'A' }, assister: null })
  })

  it('garde un MatchGuid vide', () => {
    expect(normalize(msg('MatchCreated', { MatchGuid: '' }))).toEqual({
      type: 'matchCreated',
      matchGuid: ''
    })
  })
})

describe('createCrossbarDedupe', () => {
  const hit = (force: number): CrossbarHitEvent => ({
    type: 'crossbarHit',
    matchGuid: 'm',
    ballSpeed: 10,
    impactForce: force,
    lastTouch: null
  })

  it('laisse passer le premier, bloque le doublon, rouvre sur une valeur différente', () => {
    const dedupe = createCrossbarDedupe()
    expect(dedupe(hit(5))).not.toBeNull()
    expect(dedupe(hit(5))).toBeNull()
    expect(dedupe(hit(6))).not.toBeNull()
  })

  it('ne touche pas aux autres events et garde la mémoire malgré eux', () => {
    const dedupe = createCrossbarDedupe()
    const other: GameEvent = { type: 'matchCreated', matchGuid: 'm' }
    expect(dedupe(hit(5))).not.toBeNull()
    expect(dedupe(other)).toBe(other)
    expect(dedupe(hit(5))).toBeNull()
  })

  it('chaque filtre a sa propre mémoire', () => {
    expect(createCrossbarDedupe()(hit(5))).not.toBeNull()
    expect(createCrossbarDedupe()(hit(5))).not.toBeNull()
  })
})

describe('parseCaptureText', () => {
  it('ignore les lignes vides', () => {
    expect(parseCaptureText('{"t":0,"raw":"a"}\n\n{"t":5,"raw":"b"}\n')).toEqual([
      { t: 0, raw: 'a' },
      { t: 5, raw: 'b' }
    ])
  })

  it('refuse une ligne qui n’est pas une trame, avec son numéro', () => {
    expect(() => parseCaptureText('{"t":0,"raw":"a"}\n{"x":1}')).toThrow('ligne 2')
    expect(() => parseCaptureText('pas du json')).toThrow('ligne 1')
  })
})
