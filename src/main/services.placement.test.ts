import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PacksSnapshot } from '@core/index'
import { createDemoPack } from '@server/test-utils/fixtures'
import { Services } from './services'

describe('Services : position et échelle des modules', () => {
  let base: string
  let configFile: string
  const started: Services[] = []

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'rl-studio-placement-'))
    configFile = join(base, 'userData', 'config.json')
    await createDemoPack(base)
  })
  afterEach(async () => {
    for (const s of started.splice(0)) await s.stop()
    await rm(base, { recursive: true, force: true })
  })

  async function create(): Promise<Services> {
    // Port de jeu 1 : jamais ouvert, la connexion échoue sans toucher au vrai jeu (49124).
    const services = new Services({
      configFile,
      overlaysDir: join(base, 'overlays'),
      sdkSource: '',
      overlayPort: 0,
      gameWebPort: 1
    })
    started.push(services)
    await services.start()
    return services
  }

  const bar = (snapshot: PacksSnapshot): PacksSnapshot['packs'][number]['modules'][number] =>
    snapshot.packs[0].modules.find((m) => m.id === 'bar')!

  it('change la position, l’annonce et la mémorise', async () => {
    const services = await create()
    const announced: PacksSnapshot[] = []
    services.onPacks((p) => announced.push(p))

    const snapshot = await services.setModulePlacement('demo/bar', {
      position: { anchor: 'bottom-left', x: 12, y: 34 }
    })

    expect(bar(snapshot).position).toEqual({ anchor: 'bottom-left', x: 12, y: 34 })
    expect(bar(snapshot).scale).toBe(1)
    expect(announced).toHaveLength(1)
    await services.stop()
    expect(JSON.parse(await readFile(configFile, 'utf8')).modules['demo/bar']).toEqual({
      enabled: false,
      position: { anchor: 'bottom-left', x: 12, y: 34 }
    })
  })

  it('change l’échelle sans toucher à la position', async () => {
    const services = await create()
    await services.setModulePlacement('demo/bar', { position: { anchor: 'top', x: 1, y: 2 } })
    const snapshot = await services.setModulePlacement('demo/bar', { scale: 1.5 })
    expect(bar(snapshot)).toMatchObject({ scale: 1.5, position: { anchor: 'top', x: 1, y: 2 } })
  })

  it('null rétablit les valeurs du manifeste et de l’échelle', async () => {
    const services = await create()
    await services.setModulePlacement('demo/bar', {
      position: { anchor: 'right', x: 5, y: 5 },
      scale: 2
    })
    const snapshot = await services.setModulePlacement('demo/bar', { position: null, scale: null })
    expect(bar(snapshot).position).toEqual(bar(snapshot).defaultPosition)
    expect(bar(snapshot).scale).toBe(1)
    expect(services.config.config.modules['demo/bar']).toEqual({ enabled: false })
  })

  it('ne change pas l’activation du module', async () => {
    const services = await create()
    await services.setModuleEnabled('demo/bar', true)
    await services.setModulePlacement('demo/bar', { scale: 2 })
    expect(services.config.config.modules['demo/bar'].enabled).toBe(true)

    await services.setModulePlacement('demo/racine', { scale: 2 })
    expect(services.config.config.modules['demo/racine'].enabled).toBe(false)
  })

  it('persiste d’un lancement à l’autre', async () => {
    const first = await create()
    await first.setModulePlacement('demo/bar', {
      position: { anchor: 'center', x: 0, y: 40 },
      scale: 0.75
    })
    await first.stop()

    const second = await create()
    expect(bar(second.getState().packs)).toMatchObject({
      position: { anchor: 'center', x: 0, y: 40 },
      scale: 0.75
    })
  })

  it.each([
    [{ anchor: 'milieu', x: 0, y: 0 }],
    [{ anchor: 'top-left', x: 'a', y: 0 }],
    [{ anchor: 'top-left' }]
  ])('refuse la position %j', async (position) => {
    const services = await create()
    await expect(
      services.setModulePlacement('demo/bar', { position: position as never })
    ).rejects.toThrow('Position invalide')
    expect(services.config.config.modules['demo/bar']).toBeUndefined()
  })

  it.each([0, -1, 0.1, 5, Infinity, NaN])('refuse l’échelle %s', async (scale) => {
    const services = await create()
    await expect(services.setModulePlacement('demo/bar', { scale })).rejects.toThrow(
      'Échelle invalide'
    )
    expect(services.config.config.modules['demo/bar']).toBeUndefined()
  })

  it.each(['demo/inconnu', 'inconnu/bar', '../x', 'demo'])('refuse le module %s', async (key) => {
    const services = await create()
    await expect(services.setModulePlacement(key, { scale: 1 })).rejects.toThrow('introuvable')
  })
})
