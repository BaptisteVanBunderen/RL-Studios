import { describe, expect, it } from 'vitest'
import { ANCHORS, type Anchor } from './manifest'
import { offsetFromPosition, placeInArea, type Rect } from './placement'

const AREA: Rect = { x: 0, y: 0, width: 1920, height: 1080 }
const SIZE = { width: 300, height: 231 }

describe('offsetFromPosition (inverse de placeInArea)', () => {
  it('exemple de la maquette : X 1620, Y 42 en haut à droite', () => {
    // 1920 - 300 - 1620 = 0 : collé au bord droit ; Y : 42 depuis le haut
    expect(offsetFromPosition('top-right', { x: 1620, y: 42 }, SIZE, AREA)).toEqual({
      anchor: 'top-right',
      x: 0,
      y: 42
    })
  })

  it.each<[Anchor, number, number]>([
    ['top-left', 100, 50],
    ['top', 100, 50],
    ['top-right', 100, 50],
    ['left', 100, 50],
    ['center', 100, 50],
    ['right', 100, 50],
    ['bottom-left', 100, 50],
    ['bottom', 100, 50],
    ['bottom-right', 100, 50]
  ])('%s : replacer le résultat redonne la position demandée', (anchor, x, y) => {
    const position = offsetFromPosition(anchor, { x, y }, SIZE, AREA)
    expect(placeInArea(position, SIZE, AREA)).toMatchObject({ x, y })
  })

  it('aller-retour pour toutes les ancres sur une grille de positions, écrans décalés compris', () => {
    const areas: Rect[] = [
      AREA,
      { x: 1920, y: 0, width: 2560, height: 1400 },
      { x: -1920, y: -200, width: 1920, height: 1080 },
      { x: 0, y: 0, width: 800, height: 600 }
    ]
    for (const area of areas) {
      for (const anchor of ANCHORS) {
        for (let x = area.x; x <= area.x + area.width - SIZE.width; x += 137) {
          for (let y = area.y; y <= area.y + area.height - SIZE.height; y += 91) {
            const position = offsetFromPosition(anchor, { x, y }, SIZE, area)
            const placed = placeInArea(position, SIZE, area)
            expect([placed.x, placed.y]).toEqual([x, y])
          }
        }
      }
    }
  })

  it('une position hors de la zone est ramenée dans la zone', () => {
    const position = offsetFromPosition('top-left', { x: 99999, y: -500 }, SIZE, AREA)
    expect(placeInArea(position, SIZE, AREA)).toMatchObject({ x: 1620, y: 0 })
  })

  it('garde l’ancre demandée et renvoie des entiers', () => {
    const position = offsetFromPosition('center', { x: 100.4, y: 50.6 }, SIZE, AREA)
    expect(position.anchor).toBe('center')
    expect(Number.isInteger(position.x) && Number.isInteger(position.y)).toBe(true)
  })

  it('un décalage positif éloigne du bord de l’ancre (à droite : vers la gauche)', () => {
    const left = offsetFromPosition('top-right', { x: 1000, y: 0 }, SIZE, AREA)
    expect(left.x).toBe(1920 - 300 - 1000)
  })
})
