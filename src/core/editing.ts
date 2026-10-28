import { MAX_SCALE, MIN_SCALE } from './config'
import type { Rect, Size } from './placement'

/** Distance (px) en dessous de laquelle un bord s'aimante au bord ou au centre de l'écran. */
export const SNAP_DISTANCE = 8

function snapAxis(position: number, size: number, origin: number, length: number): number {
  const targets = [origin, origin + (length - size) / 2, origin + length - size]
  for (const target of targets) {
    if (Math.abs(position - target) <= SNAP_DISTANCE) return Math.round(target)
  }
  return position
}

/**
 * Déplace un rectangle de (dx, dy) en le gardant DANS la zone, avec aimantation aux bords et au
 * centre. Sert au mode édition : la fenêtre ne peut pas être lâchée hors de l'écran.
 */
export function moveRect(start: Rect, dx: number, dy: number, area: Rect, snap = true): Rect {
  const maxX = area.x + Math.max(0, area.width - start.width)
  const maxY = area.y + Math.max(0, area.height - start.height)
  let x = Math.min(Math.max(start.x + dx, area.x), maxX)
  let y = Math.min(Math.max(start.y + dy, area.y), maxY)
  if (snap) {
    x = snapAxis(x, start.width, area.x, area.width)
    y = snapAxis(y, start.height, area.y, area.height)
  }
  return { x: Math.round(x), y: Math.round(y), width: start.width, height: start.height }
}

/**
 * Échelle obtenue en tirant la poignée du coin bas-droit jusqu'au pointeur : la largeur suit le
 * pointeur, la hauteur en découle (proportions verrouillées). Bornée par les limites d'échelle et
 * par la zone (le bord droit et le bord bas du module restent dans l'écran). Arrondie au centième.
 */
export function scaleFromDrag(
  size: Size,
  topLeft: { x: number; y: number },
  pointer: { x: number; y: number },
  area: Rect
): number {
  const wanted = Math.max(
    (pointer.x - topLeft.x) / size.width,
    (pointer.y - topLeft.y) / size.height
  )
  const roomX = (area.x + area.width - topLeft.x) / size.width
  const roomY = (area.y + area.height - topLeft.y) / size.height
  const max = Math.max(MIN_SCALE, Math.min(MAX_SCALE, roomX, roomY))
  const scale = Math.min(Math.max(wanted, MIN_SCALE), max)
  return Math.round(scale * 100) / 100
}
