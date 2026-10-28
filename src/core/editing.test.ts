import { describe, expect, it } from 'vitest'
import { acceleratorFromKey, isValidAccelerator } from './accelerator'
import { MAX_SCALE, MIN_SCALE } from './config'
import { SNAP_DISTANCE, moveRect, scaleFromDrag } from './editing'

const area = { x: 0, y: 0, width: 1920, height: 1080 }
const box = { x: 500, y: 400, width: 400, height: 100 }

describe('moveRect', () => {
  it('déplace sans aimanter loin des bords', () => {
    expect(moveRect(box, 30, -20, area)).toEqual({ x: 530, y: 380, width: 400, height: 100 })
  })

  it('reste dans la zone, même tiré très loin', () => {
    expect(moveRect(box, -9999, -9999, area)).toMatchObject({ x: 0, y: 0 })
    expect(moveRect(box, 9999, 9999, area)).toMatchObject({ x: 1520, y: 980 })
  })

  it('s’aimante aux bords et au centre à moins de 8 px', () => {
    expect(moveRect(box, -(500 - SNAP_DISTANCE), 0, area).x).toBe(0)
    expect(moveRect(box, 1520 - 500 - 5, 0, area).x).toBe(1520)
    expect(moveRect({ ...box, x: 0 }, 760 + 3, 0, area).x).toBe(760)
  })

  it('ne s’aimante pas au-delà du seuil, ni sans aimantation', () => {
    expect(moveRect(box, -(500 - SNAP_DISTANCE - 1), 0, area).x).toBe(SNAP_DISTANCE + 1)
    expect(moveRect(box, -495, 0, area, false).x).toBe(5)
  })

  it('tient compte d’une zone qui ne commence pas à 0 (second écran)', () => {
    const second = { x: 1920, y: 0, width: 1280, height: 1024 }
    expect(moveRect({ ...box, x: 2000 }, -9999, 0, second).x).toBe(1920)
  })

  it('aligne sur le coin d’une fenêtre plus grande que la zone', () => {
    expect(moveRect({ x: 5, y: 5, width: 3000, height: 100 }, 50, 0, area).x).toBe(0)
  })
})

describe('scaleFromDrag', () => {
  const size = { width: 400, height: 100 }
  const topLeft = { x: 100, y: 100 }

  it('la largeur suit le pointeur, proportions verrouillées', () => {
    expect(scaleFromDrag(size, topLeft, { x: 700, y: 150 }, area)).toBe(1.5)
  })

  it('suit aussi la hauteur quand elle dépasse', () => {
    expect(scaleFromDrag(size, topLeft, { x: 200, y: 400 }, area)).toBe(3)
  })

  it('reste dans les bornes d’échelle', () => {
    expect(scaleFromDrag(size, topLeft, { x: 100, y: 100 }, area)).toBe(MIN_SCALE)
    const huge = scaleFromDrag(size, { x: 0, y: 0 }, { x: 99999, y: 99999 }, area)
    expect(huge).toBeLessThanOrEqual(MAX_SCALE)
  })

  it('ne sort pas de l’écran', () => {
    // coin haut-gauche à x=1520 : il reste 400 px de large, soit l'échelle 1
    expect(scaleFromDrag(size, { x: 1520, y: 0 }, { x: 5000, y: 10 }, area)).toBe(1)
  })
})

describe('accélérateurs', () => {
  it('valide les formes usuelles', () => {
    for (const ok of ['Ctrl+Shift+F9', 'Alt+O', 'F8', 'Ctrl+Alt+Shift+1', 'Ctrl+Left']) {
      expect(isValidAccelerator(ok), ok).toBe(true)
    }
  })

  it('refuse une lettre seule, un modificateur seul, un doublon ou une touche inconnue', () => {
    for (const bad of ['O', 'Ctrl', 'Ctrl+Ctrl+O', 'Ctrl+é', 'Super+O', '', 'Ctrl+F25', 'Ctrl++']) {
      expect(isValidAccelerator(bad), bad).toBe(false)
    }
  })

  it('construit l’accélérateur depuis une touche, modificateurs dans l’ordre fixe', () => {
    const base = { ctrlKey: false, altKey: false, shiftKey: false }
    expect(acceleratorFromKey({ ...base, ctrlKey: true, shiftKey: true, code: 'F9' })).toBe(
      'Ctrl+Shift+F9'
    )
    expect(acceleratorFromKey({ ...base, altKey: true, ctrlKey: true, code: 'KeyO' })).toBe(
      'Ctrl+Alt+O'
    )
    expect(acceleratorFromKey({ ...base, ctrlKey: true, code: 'ArrowUp' })).toBe('Ctrl+Up')
  })

  it('ignore les appuis non utilisables', () => {
    const none = { ctrlKey: false, altKey: false, shiftKey: false }
    expect(acceleratorFromKey({ ...none, ctrlKey: true, code: 'ControlLeft' })).toBeNull()
    expect(acceleratorFromKey({ ...none, code: 'KeyO' })).toBeNull()
  })
})
