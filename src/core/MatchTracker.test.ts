import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCrossbarDedupe } from './dedupe'
import type { GameEvent, PlayerState, UpdateEvent } from './events'
import type { MatchResult } from './match'
import { MatchTracker } from './MatchTracker'
import { normalize } from './normalize'
import { SessionStore } from './session'
import { loadCapture } from './test-utils/loadCapture'

// ---------------------------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------------------------

const ME = 'Epic|me|0'

function player(name: string, primaryId: string, teamNum: number): PlayerState {
  return {
    name,
    shortcut: 1,
    teamNum,
    primaryId,
    score: 0,
    goals: 0,
    shots: 0,
    assists: 0,
    saves: 0,
    demos: 0,
    touches: 0,
    speed: null,
    boost: null
  }
}

/** Trame d'état par défaut : en ligne (2), joueur local « me » en équipe 1, vu par `Target`. */
function update(over: Partial<UpdateEvent> = {}): UpdateEvent {
  return {
    type: 'update',
    matchGuid: 'G1',
    playlistId: 2,
    timeSeconds: 100,
    overtime: false,
    isReplay: false,
    isHistoryReplay: false,
    ballSpeed: 0,
    teams: [
      { teamNum: 0, name: 'Blue', score: 0 },
      { teamNum: 1, name: 'Orange', score: 0 }
    ],
    players: [player('me', ME, 1), player('other', 'Epic|other|0', 0)],
    target: { name: 'me', shortcut: 1, teamNum: 1, primaryId: ME },
    ...over
  }
}

const ended = (winnerTeamNum: number, matchGuid = 'G1'): GameEvent => ({
  type: 'matchEnded',
  matchGuid,
  winnerTeamNum
})
const destroyed = (matchGuid = 'G1'): GameEvent => ({ type: 'matchDestroyed', matchGuid })
const winStatfeed = (teamNum: number): GameEvent => ({
  type: 'statfeed',
  matchGuid: 'G1',
  name: 'Win',
  label: 'Win',
  mainTarget: { name: 'x', shortcut: 1, teamNum },
  secondaryTarget: null
})

/** Envoie les events au tracker et renvoie tous les résultats produits. */
function feed(tracker: MatchTracker, events: GameEvent[]): MatchResult[] {
  const results: MatchResult[] = []
  for (const e of events) {
    const { result } = tracker.handle(e)
    if (result) results.push(result)
  }
  return results
}

/** Rejoue une capture dans un tracker neuf et renvoie ses résultats (freeplay compris). */
function trackCapture(name: string): { tracker: MatchTracker; results: MatchResult[] } {
  const tracker = new MatchTracker()
  const dedupe = createCrossbarDedupe()
  const results: MatchResult[] = []
  for (const frame of loadCapture(name)) {
    const parsed = normalize(frame.raw)
    const event = parsed && dedupe(parsed)
    if (!event) continue
    const { result } = tracker.handle(event)
    if (result) results.push(result)
  }
  return { tracker, results }
}

/** Résultats comptés en session (filtre du freeplay appliqué), dans l'ordre. */
function counted(results: MatchResult[]): MatchResult[] {
  const store = new SessionStore()
  return results.filter((r) => store.add(r))
}

// ---------------------------------------------------------------------------------------------
// Oracle : les captures de référence
// ---------------------------------------------------------------------------------------------

describe('captures de référence (oracle)', () => {
  it('match-complet → victoire (équipe 1 gagne, joueur local en équipe 1)', () => {
    const { tracker, results } = trackCapture('2026-10-01_match-complet')
    expect(counted(results)).toMatchObject([
      { kind: 'matchEnded', won: true, myTeamNum: 1, winnerTeamNum: 1, playlistId: 2 }
    ])
    expect(tracker.localPlayerId).toMatch(/^Epic\|/)
  })

  it('abandon → défaite (quitté en menant 1-0, aucun MatchEnded)', () => {
    const { results } = trackCapture('2026-10-01_abandon')
    expect(counted(results)).toMatchObject([{ kind: 'abandon', won: false, winnerTeamNum: null }])
  })

  it('prive-admin → victoire (score modifié par l’admin, MatchEnded vainqueur 1)', () => {
    const { results } = trackCapture('2026-10-01_prive-admin')
    // L'équipe du joueur local passe 1 → 0 → 255 → 1 pendant le lobby : on décide à la fin.
    expect(counted(results)).toMatchObject([
      { kind: 'matchEnded', won: true, myTeamNum: 1, playlistId: 6 }
    ])
  })

  it('freeplay → rien n’est compté', () => {
    const { results } = trackCapture('2026-10-01_freeplay')
    expect(counted(results)).toEqual([])
  })

  it('replay-historique → aucun résultat, aucun état de match', () => {
    const { tracker, results } = trackCapture('2026-10-01_replay-historique')
    expect(results).toEqual([])
    expect(tracker.match).toBeNull()
    expect(tracker.inHistoryReplay).toBe(true)
  })

  describe('session-7-matchs-ff : les 7 résultats de …matches.jsonl', () => {
    interface Expected {
      guid: string
      playlistId: number
      myTeam: number
      ruleResult: 'VICTOIRE' | 'DÉFAITE'
      ruleWhy: string
    }
    const expected: Expected[] = readFileSync(
      resolve(process.cwd(), 'captures', '2026-10-02_session-7-matchs-ff.matches.jsonl'),
      'utf8'
    )
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))

    const kindOf = (why: string): MatchResult['kind'] =>
      why.startsWith('MatchEnded')
        ? 'matchEnded'
        : why.startsWith('abandon')
          ? 'abandon'
          : 'statfeed'

    const { results } = trackCapture('2026-10-02_session-7-matchs-ff')
    const real = counted(results)

    it('compte exactement les 7 matchs, dans l’ordre', () => {
      expect(expected).toHaveLength(7)
      expect(real.map((r) => r.matchGuid)).toEqual(expected.map((e) => e.guid))
    })

    it.each(expected.map((e, i) => [i + 1, e] as const))(
      'match %i : même résultat, même cause, même équipe, même mode',
      (i, e) => {
        const r = real[i - 1]
        expect(r.won).toBe(e.ruleResult === 'VICTOIRE')
        expect(r.kind).toBe(kindOf(e.ruleWhy))
        expect(r.myTeamNum).toBe(e.myTeam)
        expect(r.playlistId).toBe(e.playlistId)
      }
    )

    it('la session finale correspond (3 victoires, 4 défaites)', () => {
      const store = new SessionStore()
      for (const r of results) store.add(r)
      expect(store.state).toMatchObject({ wins: 3, losses: 4, streak: 1, bestStreak: 1 })
    })
  })
})

// ---------------------------------------------------------------------------------------------
// Règles unitaires
// ---------------------------------------------------------------------------------------------

describe('joueur local', () => {
  it('est appris via Game.Target hors replay, par PrimaryId', () => {
    const t = new MatchTracker()
    t.handle(update())
    expect(t.localPlayerId).toBe(ME)
    expect(t.match).toMatchObject({ localPlayerId: ME, myTeamNum: 1 })
  })

  it('n’est PAS appris pendant un replay (Target suit la caméra)', () => {
    const t = new MatchTracker()
    t.handle(update({ isReplay: true }))
    expect(t.localPlayerId).toBeNull()
  })

  it('n’est pas remplacé quand Target change ensuite (la caméra bouge)', () => {
    const t = new MatchTracker()
    t.handle(update())
    t.handle(
      update({ target: { name: 'other', shortcut: 2, teamNum: 0, primaryId: 'Epic|other|0' } })
    )
    expect(t.localPlayerId).toBe(ME)
    expect(t.match?.myTeamNum).toBe(1)
  })

  it('peut être imposé (config) avant la première trame', () => {
    const t = new MatchTracker({ localPlayerId: 'Epic|other|0' })
    t.handle(update({ target: null }))
    expect(t.match?.myTeamNum).toBe(0) // retrouvé dans la liste des joueurs, sans Target
  })
})

describe('équipe du joueur local', () => {
  it('garde la dernière valeur valide : 255 est transitoire', () => {
    const t = new MatchTracker()
    t.handle(update())
    t.handle(
      update({
        players: [],
        target: { name: 'me', shortcut: 1, teamNum: 255, primaryId: ME }
      })
    )
    expect(t.match?.myTeamNum).toBe(1)
  })

  it('suit un changement d’équipe avant le début (privé : 0 puis 1) et décide à la fin', () => {
    const t = new MatchTracker({ localPlayerId: ME }) // identité déjà connue, sans Target
    t.handle(update({ players: [player('me', ME, 0)], target: null }))
    expect(t.match?.myTeamNum).toBe(0)
    t.handle(update({ players: [player('me', ME, 1)], target: null }))
    const [result] = feed(t, [ended(1)])
    expect(result).toMatchObject({ won: true, myTeamNum: 1 })
  })

  it('ne bouge pas pendant un replay de but', () => {
    const t = new MatchTracker()
    t.handle(update())
    t.handle(update({ isReplay: true, players: [player('me', ME, 0)], target: null }))
    expect(t.match?.myTeamNum).toBe(1)
    expect(t.match?.isReplay).toBe(true)
  })
})

describe('règle de résultat : MatchEnded → sinon statfeed Win → sinon défaite', () => {
  it('MatchEnded : victoire si WinnerTeamNum = mon équipe, défaite sinon', () => {
    const win = new MatchTracker()
    win.handle(update())
    expect(feed(win, [ended(1)])).toMatchObject([{ kind: 'matchEnded', won: true }])

    const loss = new MatchTracker()
    loss.handle(update())
    expect(feed(loss, [ended(0)])).toMatchObject([{ kind: 'matchEnded', won: false }])
  })

  it('MatchEnded prime sur le score : même en menant, la défaite compte', () => {
    const t = new MatchTracker()
    t.handle(
      update({
        teams: [
          { teamNum: 0, name: 'Blue', score: 0 },
          { teamNum: 1, name: 'Orange', score: 5 }
        ]
      })
    )
    expect(feed(t, [ended(0)])).toMatchObject([{ won: false }])
  })

  it('sans MatchEnded, le statfeed Win donne le vainqueur', () => {
    const t = new MatchTracker()
    t.handle(update())
    const results = feed(t, [winStatfeed(1), destroyed()])
    expect(results).toMatchObject([{ kind: 'statfeed', won: true, winnerTeamNum: 1 }])
  })

  it('sans MatchEnded ni statfeed : abandon = défaite, même en menant 1-0', () => {
    const t = new MatchTracker()
    t.handle(
      update({
        teams: [
          { teamNum: 0, name: 'Blue', score: 0 },
          { teamNum: 1, name: 'Orange', score: 1 }
        ]
      })
    )
    expect(feed(t, [destroyed()])).toMatchObject([
      { kind: 'abandon', won: false, winnerTeamNum: null }
    ])
  })

  it('un seul résultat par match, même après MatchEnded puis MatchDestroyed', () => {
    const t = new MatchTracker()
    t.handle(update())
    expect(feed(t, [ended(1), update(), destroyed(), destroyed()])).toHaveLength(1)
  })

  it('sans équipe connue pour le joueur local, on ne devine pas', () => {
    const t = new MatchTracker()
    t.handle(update({ players: [], target: null }))
    expect(feed(t, [ended(1)])).toEqual([])
  })

  it('MatchEnded sans aucune trame d’état préalable est ignoré', () => {
    expect(feed(new MatchTracker(), [ended(1)])).toEqual([])
  })

  it('le GUID vide au début est complété par la suite', () => {
    const t = new MatchTracker()
    t.handle(update({ matchGuid: '' }))
    t.handle(update({ matchGuid: 'G1' }))
    expect(feed(t, [ended(1, '')])).toMatchObject([{ matchGuid: 'G1' }])
  })
})

describe('enchaînement des matchs', () => {
  it('un nouveau GUID sans MatchDestroyed abandonne l’ancien match', () => {
    const t = new MatchTracker()
    t.handle(update({ matchGuid: 'A' }))
    const { result } = t.handle(update({ matchGuid: 'B' }))
    expect(result).toMatchObject({ matchGuid: 'A', kind: 'abandon', won: false })
    expect(t.match?.matchGuid).toBe('B')
  })

  it('un changement de mode sans GUID (freeplay → partie) sépare les matchs', () => {
    const t = new MatchTracker()
    t.handle(update({ matchGuid: '', playlistId: 9 }))
    const { result } = t.handle(update({ matchGuid: 'G2', playlistId: 2 }))
    expect(result).toMatchObject({ playlistId: 9 }) // abandon de freeplay, exclu ensuite par la session
  })

  it('un match fini puis détruit remet le suivi à zéro', () => {
    const t = new MatchTracker()
    t.handle(update())
    t.handle(ended(1))
    expect(t.match?.status).toBe('ended')
    expect(t.match?.winnerTeamNum).toBe(1)
    const { matchChanged } = t.handle(destroyed())
    expect(matchChanged).toBe(true)
    expect(t.match).toBeNull()
  })
})

describe('replay d’historique', () => {
  it('aucun effet : ni état, ni résultat, ni apprentissage du joueur', () => {
    const t = new MatchTracker()
    const results = feed(t, [
      { type: 'replayCreated', fileName: 'F', date: 'D' },
      update({ isHistoryReplay: true, isReplay: true }),
      ended(1),
      destroyed(),
      { type: 'matchCreated', matchGuid: 'G1' }
    ])
    expect(results).toEqual([])
    expect(t.match).toBeNull()
    expect(t.localPlayerId).toBeNull()
    expect(t.inHistoryReplay).toBe(true)
  })

  it('se termine à la première trame d’état sans Game.Frame', () => {
    const t = new MatchTracker()
    t.handle({ type: 'replayCreated', fileName: 'F', date: 'D' })
    expect(t.inHistoryReplay).toBe(true)
    t.handle(update())
    expect(t.inHistoryReplay).toBe(false)
    expect(t.match).not.toBeNull()
    expect(feed(t, [ended(1)])).toHaveLength(1)
  })
})

describe('MatchState', () => {
  it('reprend le score de référence Game.Teams[].Score', () => {
    const t = new MatchTracker()
    const teams = [
      { teamNum: 0, name: 'Blue', score: 3 },
      { teamNum: 1, name: 'Orange', score: 2 }
    ]
    const { matchChanged } = t.handle(update({ teams, timeSeconds: 42, overtime: true }))
    expect(matchChanged).toBe(true)
    expect(t.match).toMatchObject({
      status: 'inProgress',
      teams,
      timeSeconds: 42,
      overtime: true,
      winnerTeamNum: null
    })
  })

  it('un event sans effet sur l’état ne demande pas de rediffusion', () => {
    const t = new MatchTracker()
    t.handle(update())
    const { matchChanged, result } = t.handle({
      type: 'playerJoined',
      matchGuid: 'G1',
      playerName: 'x',
      primaryId: 'y'
    })
    expect({ matchChanged, result }).toEqual({ matchChanged: false, result: null })
  })
})
