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
