import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Language } from '@core/index'
import { createDemoPack } from '@server/test-utils/fixtures'
import { Services } from './services'

describe('Services : langue de l’interface', () => {
  let base: string
  const started: Services[] = []

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'rl-studio-lang-'))
    await createDemoPack(base)
  })
  afterEach(async () => {
    for (const s of started.splice(0)) await s.stop()
    await rm(base, { recursive: true, force: true })
  })

  async function create(systemLanguage?: Language): Promise<Services> {
    const services = new Services({
      configFile: join(base, 'userData', 'config.json'),
      overlaysDir: join(base, 'overlays'),
      sdkSource: '',
      overlayPort: 0,
      gameWebPort: 1,
      ...(systemLanguage ? { systemLanguage } : {})
    })
    started.push(services)
    await services.start()
    return services
  }

  it('suit la langue du système tant que l’utilisateur n’a rien choisi, sinon le français', async () => {
    expect((await create('en')).getState().language).toBe('en')
    await started.pop()!.stop()
    expect((await create()).getState().language).toBe('fr')
  })

  it('change la langue, la prévient, et la retient au lancement suivant', async () => {
    const services = await create('fr')
    const seen: Language[] = []
    services.onLanguage((l) => seen.push(l))

    expect(await services.setLanguage('en')).toBe('en')
    await services.setLanguage('en') // inchangée : aucune notification de plus
    expect(seen).toEqual(['en'])
    expect(services.getState().language).toBe('en')

    const saved = JSON.parse(await readFile(services.config.path, 'utf8')) as { language: string }
    expect(saved.language).toBe('en')

    await services.stop()
    started.pop()
    // le choix de l'utilisateur l'emporte sur la langue du système
    expect((await create('fr')).getState().language).toBe('en')
  })

  it('refuse une langue inconnue', async () => {
    const services = await create()
    await expect(services.setLanguage('de' as Language)).rejects.toThrow(/Langue inconnue/)
  })

  it('les erreurs montrées à l’utilisateur suivent la langue', async () => {
    const services = await create('fr')
    await expect(services.setModulePlacement('nope/x', {})).rejects.toThrow(/Module introuvable/)
    await services.setLanguage('en')
    await expect(services.setModulePlacement('nope/x', {})).rejects.toThrow(/Module not found/)
    await expect(services.configureStatsApi(500)).rejects.toThrow(/Packets per second/)
    expect(() => services.setGameHud(true)).toThrow(/not connected/)
  })
})
