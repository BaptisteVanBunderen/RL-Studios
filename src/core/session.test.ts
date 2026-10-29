import { describe, expect, it } from 'vitest'
import type { MatchResult } from './match'
import { SessionStore, emptySession } from './session'

function result(won: boolean, over: Partial<MatchResult> = {}): MatchResult {
  return {
    matchGuid: `G${Math.random()}`,
    won,
    playlistId: 2,
    kind: 'matchEnded',
    myTeamNum: 1,
    winnerTeamNum: won ? 1 : 0,
    ...over
  }
}

describe('SessionStore', () => {
  it('démarre vide', () => {
    expect(new SessionStore().state).toEqual(emptySession())
  })

  it('compte victoires et défaites et retient le dernier résultat', () => {
    const s = new SessionStore()
    s.add(result(true, { playlistId: 11 }))
    s.add(result(false, { playlistId: 6 }))
    expect(s.state).toMatchObject({
      wins: 1,
      losses: 1,
      lastResult: { won: false, playlistId: 6 }
    })
  })

  it('série signée : positive en victoires, négative en défaites, meilleure série conservée', () => {
    const s = new SessionStore()
    const streaks: number[] = []
    for (const won of [true, true, true, false, false, true]) {
      s.add(result(won))
      streaks.push(s.state.streak)
    }
    expect(streaks).toEqual([1, 2, 3, -1, -2, 1])
    expect(s.state.bestStreak).toBe(3)
  })

  it('exclut le freeplay mais pas les parties privées', () => {
    const s = new SessionStore()
    expect(s.add(result(true, { playlistId: 9 }))).toBe(false)
    expect(s.add(result(true, { playlistId: 6 }))).toBe(true)
    expect(s.state.wins).toBe(1)
  })

  it('un mode jamais vu ou inconnu compte par défaut (liste d’exclusion)', () => {
    const s = new SessionStore()
    expect(s.add(result(true, { playlistId: 27 }))).toBe(true)
    expect(s.add(result(true, { playlistId: null }))).toBe(true)
  })

  it('dédoublonne par MatchGuid', () => {
    const s = new SessionStore()
    expect(s.add(result(true, { matchGuid: 'X' }))).toBe(true)
    expect(s.add(result(true, { matchGuid: 'X' }))).toBe(false)
    expect(s.state.wins).toBe(1)
  })

  it('un GUID vide ne sert pas de clé : deux résultats comptent', () => {
    const s = new SessionStore()
    s.add(result(true, { matchGuid: '' }))
    s.add(result(true, { matchGuid: '' }))
    expect(s.state.wins).toBe(2)
  })

  it('reset remet à zéro mais un match déjà compté ne recompte pas', () => {
    const s = new SessionStore()
    s.add(result(true, { matchGuid: 'X' }))
    s.reset()
    expect(s.state).toEqual(emptySession())
    expect(s.add(result(true, { matchGuid: 'X' }))).toBe(false)
    expect(s.add(result(true, { matchGuid: 'Y' }))).toBe(true)
  })

  it('state renvoie une copie : la modifier n’affecte pas le store', () => {
    const s = new SessionStore()
    s.add(result(true))
    const copy = s.state
    copy.wins = 99
    if (copy.lastResult) copy.lastResult.won = false
    expect(s.state.wins).toBe(1)
    expect(s.state.lastResult?.won).toBe(true)
  })
})

describe('SessionStore.adjust (correction manuelle)', () => {
  it('remplace les compteurs fournis et laisse les autres', () => {
    const s = new SessionStore()
    s.add(result(true))
    s.add(result(false))
    expect(s.adjust({ wins: 12, losses: 3 })).toBe(true)
    expect(s.state).toMatchObject({ wins: 12, losses: 3, streak: -1 })
  })

  it('la série corrigée à la hausse relève la meilleure série ; elle ne baisse jamais', () => {
    const s = new SessionStore()
    s.adjust({ streak: 4 })
    expect(s.state).toMatchObject({ streak: 4, bestStreak: 4 })
    s.adjust({ streak: 1 })
    expect(s.state).toMatchObject({ streak: 1, bestStreak: 4 })
    s.adjust({ streak: -3 })
    expect(s.state).toMatchObject({ streak: -3, bestStreak: 4 })
  })

  it('ne touche ni au dernier résultat ni aux matchs déjà comptés', () => {
    const s = new SessionStore()
    s.add(result(true, { matchGuid: 'X', playlistId: 11 }))
    s.adjust({ wins: 0 })
    expect(s.state.lastResult).toEqual({ won: true, playlistId: 11 })
    expect(s.add(result(true, { matchGuid: 'X' }))).toBe(false) // toujours dédoublonné
  })

  it('les résultats suivants repartent des valeurs corrigées', () => {
    const s = new SessionStore()
    s.adjust({ wins: 12, losses: 3, streak: 4 })
    s.add(result(true))
    expect(s.state).toMatchObject({ wins: 13, losses: 3, streak: 5, bestStreak: 5 })
  })

  it('renvoie false quand rien ne change', () => {
    const s = new SessionStore()
    s.adjust({ wins: 2 })
    expect(s.adjust({ wins: 2 })).toBe(false)
    expect(s.adjust({})).toBe(false)
  })

  it.each([-1, 1.5, 10000, NaN, Infinity])('refuse %s pour les victoires et défaites', (value) => {
    const s = new SessionStore()
    expect(() => s.adjust({ wins: value })).toThrow('Victoires')
    expect(() => s.adjust({ losses: value })).toThrow('Défaites')
    expect(s.state).toEqual(emptySession())
  })

  it.each([1.5, 10000, -10000, NaN])('refuse %s pour la série', (value) => {
    expect(() => new SessionStore().adjust({ streak: value })).toThrow('Série')
  })

  it('une valeur invalide ne modifie rien, même si une autre est valide', () => {
    const s = new SessionStore()
    expect(() => s.adjust({ wins: 5, losses: -1 })).toThrow()
    expect(s.state.wins).toBe(0)
  })
})
