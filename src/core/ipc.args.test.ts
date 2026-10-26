import { describe, expect, it } from 'vitest'
import {
  IPC_EVENTS,
  IPC_INVOKE,
  adjustSessionArgs,
  setModulePlacementArgs,
  setPackEnabledArgs
} from './ipc'

describe('setPackEnabledArgs', () => {
  it('accepte [identifiant de pack, booléen]', () => {
    expect(setPackEnabledArgs.safeParse(['session-tracker', false]).success).toBe(true)
  })

  it.each([
    [['Pas Valide', true]],
    [['pack/module', true]],
    [['../x', true]],
    [['pack']],
    [['pack', 1]],
    [[]]
  ])('refuse %j', (args) => {
    expect(setPackEnabledArgs.safeParse(args).success).toBe(false)
  })
})

describe('setModulePlacementArgs', () => {
  const key = 'pack/module'

  it('accepte une position, une échelle, les deux, ou null pour rétablir', () => {
    for (const change of [
      { position: { anchor: 'top-right', x: 10, y: 20 } },
      { scale: 1.5 },
      { position: { anchor: 'center', x: 0, y: 0 }, scale: 2 },
      { position: null, scale: null },
      {}
    ]) {
      expect(setModulePlacementArgs.safeParse([key, change]).success).toBe(true)
    }
  })

  it.each([
    [{ position: { anchor: 'milieu', x: 0, y: 0 } }],
    [{ position: { anchor: 'top', x: 'a', y: 0 } }],
    [{ scale: '2' }],
    [{ inconnu: 1 }], // clé inconnue : refusée (strict)
    ['texte'],
    [null]
  ])('refuse le changement %j', (change) => {
    expect(setModulePlacementArgs.safeParse([key, change]).success).toBe(false)
  })

  it.each([['pack'], ['a/b/c'], ['../x'], ['']])('refuse la clé de module %j', (bad) => {
    expect(setModulePlacementArgs.safeParse([bad, { scale: 1 }]).success).toBe(false)
  })
})

describe('adjustSessionArgs', () => {
  it('accepte une partie ou la totalité des compteurs', () => {
    expect(adjustSessionArgs.safeParse([{ wins: 3 }]).success).toBe(true)
    expect(adjustSessionArgs.safeParse([{ wins: 3, losses: 1, streak: -2 }]).success).toBe(true)
    expect(adjustSessionArgs.safeParse([{}]).success).toBe(true)
  })

  it.each([[{ wins: '3' }], [{ bestStreak: 5 }], [{ lastResult: null }], [[]], [null]])(
    'refuse %j',
    (values) => {
      expect(adjustSessionArgs.safeParse([values]).success).toBe(false)
    }
  )

  it('refuse l’absence d’argument', () => {
    expect(adjustSessionArgs.safeParse([]).success).toBe(false)
  })
})

describe('canaux IPC', () => {
  it('restent tous distincts après les ajouts', () => {
    const all = [...Object.values(IPC_INVOKE), ...Object.values(IPC_EVENTS)]
    expect(new Set(all).size).toBe(all.length)
    expect(all).toContain('packs:set-enabled')
    expect(all).toContain('modules:set-placement')
    expect(all).toContain('session:adjust')
    expect(all).toContain('shell:open-overlays-folder')
  })
})
