import { describe, expect, it } from 'vitest'
import { MAX_SCALE, MIN_SCALE, parseConfig } from './config'
import { toPacksSnapshot } from './ipc'
import { parseManifest } from './manifest'

describe('config : position et échelle d’un module', () => {
  const parse = (module: unknown): Record<string, unknown> =>
    parseConfig({ modules: { 'p/m': module } }).modules['p/m'] as unknown as Record<string, unknown>

  it('garde une position et une échelle valides', () => {
    expect(
      parse({ enabled: true, position: { anchor: 'bottom', x: 5, y: 10 }, scale: 1.5 })
    ).toEqual({
      enabled: true,
      position: { anchor: 'bottom', x: 5, y: 10 },
      scale: 1.5
    })
  })

  it('absents : le module n’a ni position ni échelle propres', () => {
    const module = parse({ enabled: true })
    expect(module.position).toBeUndefined()
    expect(module.scale).toBeUndefined()
  })

  it.each([
    { anchor: 'milieu', x: 0, y: 0 },
    { anchor: 'top' },
    { anchor: 'top', x: 'a', y: 0 },
    'top-left',
    42,
    null
  ])('position invalide %j : ignorée sans perdre le reste', (position) => {
    const module = parse({ enabled: true, position, scale: 2 })
    expect(module.position).toBeUndefined()
    expect(module).toMatchObject({ enabled: true, scale: 2 })
  })

  it.each([0, -1, MIN_SCALE - 0.01, MAX_SCALE + 0.01, 100, '2', null, NaN])(
    'échelle invalide %j : ignorée',
    (scale) => {
      const module = parse({ enabled: true, scale })
      expect(module.scale).toBeUndefined()
      expect(module.enabled).toBe(true)
    }
  )

  it('les bornes d’échelle sont acceptées', () => {
    expect(parse({ scale: MIN_SCALE }).scale).toBe(MIN_SCALE)
    expect(parse({ scale: MAX_SCALE }).scale).toBe(MAX_SCALE)
  })
})

describe('instantané des packs : position et échelle effectives', () => {
  const manifest = parseManifest({
    manifestVersion: 1,
    name: 'P',
    version: '1.0.0',
    modules: [
      {
        id: 'm',
        name: 'M',
        entry: 'm.html',
        size: { width: 100, height: 50 },
        defaultPosition: { anchor: 'top-right', x: 20, y: 20 }
      }
    ]
  })
  if (!manifest.ok) throw new Error('manifeste de test invalide')
  const scan = {
    packs: [{ id: 'p', dir: '/p', manifest: manifest.manifest, warnings: [] }],
    invalid: []
  }
  const module = (modules: Record<string, object>): Record<string, unknown> =>
    toPacksSnapshot(scan, { modules } as never).packs[0].modules[0] as unknown as Record<
      string,
      unknown
    >

  it('sans choix de l’utilisateur : position du manifeste, échelle 1', () => {
    expect(module({})).toMatchObject({
      position: { anchor: 'top-right', x: 20, y: 20 },
      defaultPosition: { anchor: 'top-right', x: 20, y: 20 },
      scale: 1
    })
  })

  it('avec un choix de l’utilisateur : il l’emporte, la valeur du manifeste reste disponible', () => {
    expect(
      module({ 'p/m': { enabled: true, position: { anchor: 'left', x: 1, y: 2 }, scale: 2 } })
    ).toMatchObject({
      position: { anchor: 'left', x: 1, y: 2 },
      defaultPosition: { anchor: 'top-right', x: 20, y: 20 },
      scale: 2
    })
  })
})
