import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PackLoader } from './packs/PackLoader'

describe('pack d’exemple livré avec l’application', () => {
  it('est valide, sans erreur ni avertissement', async () => {
    const { packs, invalid } = await new PackLoader(join(process.cwd(), 'overlays')).scan()
    expect(invalid).toEqual([])
    expect(packs.map((p) => p.id)).toContain('example')
    expect(packs.find((p) => p.id === 'example')?.warnings).toEqual([])
  })
})
