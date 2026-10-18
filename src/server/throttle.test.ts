import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createThrottle } from './throttle'

describe('createThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('envoie la première valeur tout de suite', () => {
    const sent: number[] = []
    createThrottle((v: number) => sent.push(v), 100).push(1)
    expect(sent).toEqual([1])
  })

  it('ne garde que la dernière valeur pendant l’intervalle, envoyée à son échéance', () => {
    const sent: number[] = []
    const t = createThrottle((v: number) => sent.push(v), 100)
    t.push(1)
    t.push(2)
    t.push(3)
    expect(sent).toEqual([1])

    vi.advanceTimersByTime(99)
    expect(sent).toEqual([1])
    vi.advanceTimersByTime(1)
    expect(sent).toEqual([1, 3]) // 2 est écrasée, la valeur finale n'est pas perdue
  })

  it('limite le débit : 1000 valeurs en 1 s à 30/s donnent environ 30 envois', () => {
    const sent: number[] = []
    const t = createThrottle((v: number) => sent.push(v), 1000 / 30)
    for (let ms = 0; ms < 1000; ms++) {
      t.push(ms)
      vi.advanceTimersByTime(1)
    }
    expect(sent.length).toBeGreaterThanOrEqual(28)
    expect(sent.length).toBeLessThanOrEqual(31)
  })

  it('après un temps calme, la valeur suivante part immédiatement', () => {
    const sent: number[] = []
    const t = createThrottle((v: number) => sent.push(v), 100)
    t.push(1)
    vi.advanceTimersByTime(500)
    t.push(2)
    expect(sent).toEqual([1, 2])
  })

  it('`null` est une valeur comme une autre', () => {
    const sent: (number | null)[] = []
    const t = createThrottle((v: number | null) => sent.push(v), 100)
    t.push(1)
    t.push(null)
    vi.advanceTimersByTime(100)
    expect(sent).toEqual([1, null])
  })

  it('cancel() abandonne la valeur en attente', () => {
    const sent: number[] = []
    const t = createThrottle((v: number) => sent.push(v), 100)
    t.push(1)
    t.push(2)
    t.cancel()
    vi.advanceTimersByTime(1000)
    expect(sent).toEqual([1])
  })
})
