import type { GameEvent } from './events'

export function createCrossbarDedupe(): (event: GameEvent) => GameEvent | null {
  let lastKey: string | null = null

  return (event) => {
    if (event.type !== 'crossbarHit') return event

    const key = `${event.matchGuid}|${event.impactForce}|${event.ballSpeed}`
    if (key === lastKey) return null
    lastKey = key
    return event
  }
}
