import type { Position } from './manifest'

export interface Size {
  width: number
  height: number
}

export interface Rect extends Size {
  x: number
  y: number
}

/** Taille d'un overlay à une échelle donnée, en pixels logiques entiers (au moins 1). */
export function scaledSize(size: Size, scale: number): Size {
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale))
  }
}

/**
 * Position (coin haut-gauche) d'une fenêtre dans une zone de travail, d'après son ancre.
 *
 * `x` et `y` sont des décalages depuis l'ancre, VERS L'INTÉRIEUR de l'écran :
 * - ancre à gauche / en haut : le décalage éloigne du bord gauche / haut (vers la droite / le bas) ;
 * - ancre à droite / en bas : le décalage éloigne du bord droit / bas (vers la gauche / le haut) ;
 * - ancre centrée sur un axe : pas d'« intérieur », le décalage est positif vers la droite / le bas.
 *
 * Le résultat est toujours ramené DANS la zone : un overlay ne peut pas être perdu hors de
 * l'écran (résolution changée, second écran débranché, décalage trop grand). Une fenêtre plus
 * grande que la zone est alignée sur son coin haut-gauche.
 */
export function placeInArea(position: Position, size: Size, area: Rect): Rect {
  const { anchor, x: dx, y: dy } = position

  const horizontal = anchor.includes('left') ? 'start' : anchor.includes('right') ? 'end' : 'middle'
  const vertical = anchor.startsWith('top')
    ? 'start'
    : anchor.startsWith('bottom')
      ? 'end'
      : 'middle'

  // « left » et « right » seuls sont centrés verticalement ; « top » et « bottom » horizontalement.
  const x = axis(horizontal, area.x, area.width, size.width, dx)
  const y = axis(vertical, area.y, area.height, size.height, dy)

  return {
    x: clamp(Math.round(x), area.x, area.x + Math.max(0, area.width - size.width)),
    y: clamp(Math.round(y), area.y, area.y + Math.max(0, area.height - size.height)),
    width: size.width,
    height: size.height
  }
}

function axis(
  side: 'start' | 'end' | 'middle',
  origin: number,
  length: number,
  size: number,
  offset: number
): number {
  if (side === 'start') return origin + offset
  if (side === 'end') return origin + length - size - offset
  return origin + (length - size) / 2 + offset
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Fenêtres à ouvrir et à fermer pour passer de l'ensemble ouvert à l'ensemble voulu. */
export function diffKeys(
  open: Iterable<string>,
  wanted: Iterable<string>
): { toOpen: string[]; toClose: string[] } {
  const openSet = new Set(open)
  const wantedSet = new Set(wanted)
  return {
    toOpen: [...wantedSet].filter((key) => !openSet.has(key)),
    toClose: [...openSet].filter((key) => !wantedSet.has(key))
  }
}

/**
 * Inverse de `placeInArea` : le décalage (`x`, `y`) qui, avec cette ancre, place la fenêtre à
 * `desired` (coin haut-gauche, pixels logiques de l'écran). Sert au client, qui affiche la
 * position absolue (X, Y) mais mémorise toujours ancre + décalage, indépendant de la résolution.
 * La position demandée est d'abord ramenée dans la zone, comme le fait `placeInArea`.
 */
export function offsetFromPosition(
  anchor: Position['anchor'],
  desired: { x: number; y: number },
  size: Size,
  area: Rect
): Position {
  const horizontal = anchor.includes('left') ? 'start' : anchor.includes('right') ? 'end' : 'middle'
  const vertical = anchor.startsWith('top')
    ? 'start'
    : anchor.startsWith('bottom')
      ? 'end'
      : 'middle'

  const x = clamp(Math.round(desired.x), area.x, area.x + Math.max(0, area.width - size.width))
  const y = clamp(Math.round(desired.y), area.y, area.y + Math.max(0, area.height - size.height))

  return {
    anchor,
    x: inverseAxis(horizontal, area.x, area.width, size.width, x),
    y: inverseAxis(vertical, area.y, area.height, size.height, y)
  }
}

function inverseAxis(
  side: 'start' | 'end' | 'middle',
  origin: number,
  length: number,
  size: number,
  position: number
): number {
  if (side === 'start') return Math.round(position - origin)
  if (side === 'end') return Math.round(origin + length - size - position)
  // Axe centré : le milieu peut tomber sur une demi-unité. `placeInArea` arrondit au plus proche
  // (demi vers le haut) : `floor` garantit que `round(milieu + décalage)` redonne la position.
  return Math.floor(position - (origin + (length - size) / 2))
}
