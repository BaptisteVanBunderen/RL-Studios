import { describe, expect, it } from 'vitest'
import { parseManifest } from './manifest'

function withCategory(category?: unknown): Record<string, unknown> {
  return {
    manifestVersion: 1,
    name: 'P',
    version: '1.0.0',
    modules: [
      {
        id: 'm',
        name: 'M',
        entry: 'm.html',
        size: { width: 10, height: 10 },
        ...(category === undefined ? {} : { category })
      }
    ]
  }
}

describe('genre d’un module (category)', () => {
  it('est facultatif', () => {
    const r = parseManifest(withCategory())
    expect(r.ok && r.manifest.modules[0].category).toBeUndefined()
  })

  it.each(['session', 'stats', 'match'])('accepte « %s »', (category) => {
    const r = parseManifest(withCategory(category))
    expect(r.ok && r.manifest.modules[0].category).toBe(category)
  })

  it('refuse un genre inconnu, avec un message lisible', () => {
    const r = parseManifest(withCategory('stat'))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.errors.join(' ')).toMatch(/category/)
  })
})
