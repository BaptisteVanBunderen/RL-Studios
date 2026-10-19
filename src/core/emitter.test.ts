import { describe, expect, it, vi } from 'vitest'
import { Emitter } from './emitter'

describe('Emitter', () => {
  it('transmet la valeur à tous les abonnés, dans l’ordre d’abonnement', () => {
    const e = new Emitter<number>()
    const got: string[] = []
    e.on((v) => got.push(`a${v}`))
    e.on((v) => got.push(`b${v}`))
    e.emit(1)
    expect(got).toEqual(['a1', 'b1'])
  })

  it('se désabonner coupe l’abonné', () => {
    const e = new Emitter<number>()
    const got: number[] = []
    const off = e.on((v) => got.push(v))
    e.emit(1)
    off()
    e.emit(2)
    expect(got).toEqual([1])
  })

  it('un abonné qui plante ne prive pas les autres et ne remonte pas à l’émetteur', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const e = new Emitter<number>()
    const got: number[] = []
    e.on(() => {
      throw new Error('boum')
    })
    e.on((v) => got.push(v))
    expect(() => e.emit(7)).not.toThrow()
    expect(got).toEqual([7])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('émettre sans abonné ne fait rien', () => {
    expect(() => new Emitter<number>().emit(1)).not.toThrow()
  })
})
