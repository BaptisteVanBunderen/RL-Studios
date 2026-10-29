import { describe, expect, it } from 'vitest'
import type { Anchor } from './manifest'
import { diffKeys, placeInArea, scaledSize, type Rect } from './placement'

const SCREEN: Rect = { x: 0, y: 0, width: 1920, height: 1080 }
const SIZE = { width: 420, height: 56 }

const at = (anchor: Anchor, x = 0, y = 0, area = SCREEN, size = SIZE): Rect =>
  placeInArea({ anchor, x, y }, size, area)

describe('placeInArea : les neuf ancres (décalage 20, 30)', () => {
  // x : gauche = 20 ; centre = (1920-420)/2 = 750 (+20) ; droite = 1920-420-20
  // y : haut = 30 ; milieu = (1080-56)/2 = 512 (+30) ; bas = 1080-56-30
  it.each<[Anchor, number, number]>([
    ['top-left', 20, 30],
    ['top', 770, 30],
    ['top-right', 1480, 30],
    ['left', 20, 542],
    ['center', 770, 542],
    ['right', 1480, 542],
    ['bottom-left', 20, 994],
    ['bottom', 770, 994],
    ['bottom-right', 1480, 994]
  ])('%s → (%i, %i)', (anchor, x, y) => {
    expect(at(anchor, 20, 30)).toEqual({ x, y, width: 420, height: 56 })
  })

  it('sans décalage, colle au bord ou au centre', () => {
    expect(at('top-left')).toMatchObject({ x: 0, y: 0 })
    expect(at('bottom-right')).toMatchObject({ x: 1500, y: 1024 })
    expect(at('center')).toMatchObject({ x: 750, y: 512 })
  })

  it('le décalage va vers l’intérieur : positif éloigne du bord de l’ancre', () => {
    // top-right : plus x est grand, plus la fenêtre se déplace vers la gauche
    expect(at('top-right', 0).x).toBeGreaterThan(at('top-right', 100).x)
    // bottom-left : plus y est grand, plus la fenêtre monte
    expect(at('bottom-left', 0, 0).y).toBeGreaterThan(at('bottom-left', 0, 100).y)
  })

  it('sur un axe centré, le décalage est positif vers la droite / le bas', () => {
    expect(at('center', 100, 0).x).toBe(850)
    expect(at('center', 0, 100).y).toBe(612)
    expect(at('top', 100, 0).x).toBe(850) // « top » est centré horizontalement
    expect(at('left', 0, 100).y).toBe(612) // « left » est centré verticalement
  })

  it('arrondit à l’entier le plus proche', () => {
    const odd = at('center', 0, 0, SCREEN, { width: 421, height: 57 }) // 749,5 et 511,5
    expect(Number.isInteger(odd.x) && Number.isInteger(odd.y)).toBe(true)
    expect(odd).toMatchObject({ x: 750, y: 512 })
  })
})

describe('placeInArea : zones de travail', () => {
  it('une barre des tâches réduit la zone : « bottom » reste au-dessus', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 }
    expect(at('bottom-left', 20, 30, area).y).toBe(1040 - 56 - 30)
  })

  it('un second écran à droite du principal', () => {
    const second = { x: 1920, y: 0, width: 2560, height: 1440 }
    expect(at('top-left', 20, 30, second)).toMatchObject({ x: 1940, y: 30 })
    expect(at('top-right', 20, 30, second).x).toBe(1920 + 2560 - 420 - 20)
  })

  it('un écran dont l’origine est négative (à gauche ou au-dessus du principal)', () => {
    const left = { x: -1920, y: -200, width: 1920, height: 1080 }
    expect(at('top-right', 20, 30, left)).toMatchObject({ x: -440, y: -170 })
    expect(at('center', 0, 0, left)).toMatchObject({ x: -1170, y: 312 })
  })
})

describe('placeInArea : l’overlay reste toujours dans la zone', () => {
  it('un décalage trop grand est ramené dans la zone', () => {
    expect(at('top-left', 5000, 5000)).toMatchObject({ x: 1500, y: 1024 })
    expect(at('bottom-right', 5000, 5000)).toMatchObject({ x: 0, y: 0 })
  })

  it('un décalage négatif ne fait pas sortir par le bord de l’ancre', () => {
    expect(at('top-left', -50, -50)).toMatchObject({ x: 0, y: 0 })
    expect(at('bottom-right', -50, -50)).toMatchObject({ x: 1500, y: 1024 })
  })

  it('un écran devenu plus petit (résolution changée) rapatrie l’overlay', () => {
    const small = { x: 0, y: 0, width: 800, height: 600 }
    const placed = at('top-right', 20, 30, small)
    expect(placed.x + placed.width).toBeLessThanOrEqual(800)
    expect(placed.y + placed.height).toBeLessThanOrEqual(600)
  })

  it('plus grand que la zone : aligné sur son coin haut-gauche', () => {
    const huge = { width: 3000, height: 2000 }
    expect(at('center', 0, 0, SCREEN, huge)).toEqual({ x: 0, y: 0, ...huge })
    expect(at('bottom-right', 0, 0, { ...SCREEN, x: 100, y: 50 }, huge)).toMatchObject({
      x: 100,
      y: 50
    })
  })

  it('conserve la taille donnée', () => {
    expect(at('center')).toMatchObject({ width: 420, height: 56 })
  })
})

describe('scaledSize', () => {
  it('multiplie en gardant les proportions, arrondi à l’entier', () => {
    expect(scaledSize(SIZE, 1)).toEqual({ width: 420, height: 56 })
    expect(scaledSize(SIZE, 1.5)).toEqual({ width: 630, height: 84 })
    expect(scaledSize(SIZE, 0.5)).toEqual({ width: 210, height: 28 })
    expect(scaledSize({ width: 101, height: 33 }, 0.5)).toEqual({ width: 51, height: 17 })
  })

  it('jamais en dessous de 1 pixel', () => {
    expect(scaledSize({ width: 1, height: 1 }, 0.25)).toEqual({ width: 1, height: 1 })
  })
})

describe('diffKeys', () => {
  it('ouvre ce qui manque, ferme ce qui est en trop', () => {
    expect(diffKeys(['a/x', 'b/y'], ['b/y', 'c/z'])).toEqual({ toOpen: ['c/z'], toClose: ['a/x'] })
  })

  it('aucun changement : rien à faire', () => {
    expect(diffKeys(['a/x'], ['a/x'])).toEqual({ toOpen: [], toClose: [] })
  })

  it('tout ouvrir, tout fermer', () => {
    expect(diffKeys([], ['a/x', 'b/y'])).toEqual({ toOpen: ['a/x', 'b/y'], toClose: [] })
    expect(diffKeys(['a/x', 'b/y'], [])).toEqual({ toOpen: [], toClose: ['a/x', 'b/y'] })
  })

  it('ignore les doublons', () => {
    expect(diffKeys(['a/x', 'a/x'], ['a/x', 'a/x', 'b/y'])).toEqual({
      toOpen: ['b/y'],
      toClose: []
    })
  })

  it('accepte n’importe quel itérable (Set, Map.keys())', () => {
    expect(diffKeys(new Set(['a/x']), new Map([['b/y', 1]]).keys())).toEqual({
      toOpen: ['b/y'],
      toClose: ['a/x']
    })
  })
})
