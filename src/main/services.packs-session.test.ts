import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PacksSnapshot, SessionState } from '@core/index'
import { createDemoPack } from '@server/test-utils/fixtures'
import { Services } from './services'

describe('Services : pack entier, session corrigée, écran', () => {
  let base: string
  let configFile: string
  const started: Services[] = []

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'rl-studio-pack-session-'))
    configFile = join(base, 'userData', 'config.json')
    await createDemoPack(base)
  })
  afterEach(async () => {
    for (const s of started.splice(0)) await s.stop()
    await rm(base, { recursive: true, force: true })
  })

  async function create(display?: unknown): Promise<Services> {
    const services = new Services({
      configFile,
      overlaysDir: join(base, 'overlays'),
      sdkSource: '',
      overlayPort: 0,
      gameWebPort: 1, // jamais ouvert : ne touche pas au vrai jeu (49124)
      ...(display ? { getDisplays: () => [display as never] } : {})
    })
    started.push(services)
    await services.start()
    return services
  }

  const enabledKeys = (snapshot: PacksSnapshot): string[] =>
    snapshot.packs.flatMap((p) => p.modules.filter((m) => m.enabled).map((m) => m.key))

  describe('packs de l’utilisateur', () => {
    it('crée le dossier de l’utilisateur, y charge ses packs et les sert', async () => {
      const userDir = join(base, 'userData', 'overlays')
      await mkdir(join(userDir, 'perso', 'modules'), { recursive: true })
      await writeFile(
        join(userDir, 'perso', 'manifest.json'),
        JSON.stringify({
          manifestVersion: 1,
          name: 'Perso',
          version: '1.0.0',
          modules: [
            { id: 'm', name: 'M', entry: 'modules/m.html', size: { width: 10, height: 10 } }
          ]
        })
      )
      await writeFile(
        join(userDir, 'perso', 'modules', 'm.html'),
        '<html><body>perso</body></html>'
      )

      const services = new Services({
        configFile,
        overlaysDir: join(base, 'overlays'),
        userOverlaysDir: userDir,
        sdkSource: '',
        overlayPort: 0,
        gameWebPort: 1
      })
      started.push(services)
      await services.start()

      expect(services.userOverlaysDir).toBe(userDir)
      expect((await stat(userDir)).isDirectory()).toBe(true)
      const ids = services.getState().packs.packs.map((p) => p.id)
      expect(ids).toContain('perso')
      expect(ids).toContain('demo')
      const res = await fetch(`${services.overlayBaseUrl()}/overlay/perso/m`)
      expect(res.status).toBe(200)
    })

    it('sans dossier utilisateur distinct, le dossier fourni sert aux deux', async () => {
      const services = await create()
      expect(services.userOverlaysDir).toBe(join(base, 'overlays'))
    })
  })

  describe('setPackEnabled', () => {
    it('active tous les modules du pack en une seule écriture et une seule notification', async () => {
      const services = await create()
      const announced: PacksSnapshot[] = []
      services.onPacks((p) => announced.push(p))

      const snapshot = await services.setPackEnabled('demo', true)

      expect(enabledKeys(snapshot)).toEqual(['demo/bar', 'demo/racine', 'demo/nohead', 'demo/vide'])
      expect(announced).toHaveLength(1)
      await services.stop()
      const saved = JSON.parse(await readFile(configFile, 'utf8')).modules
      expect(Object.keys(saved)).toHaveLength(4)
    })

    it('désactive tous les modules du pack', async () => {
      const services = await create()
      await services.setPackEnabled('demo', true)
      const snapshot = await services.setPackEnabled('demo', false)
      expect(enabledKeys(snapshot)).toEqual([])
    })

    it('désactiver un pack jamais activé n’écrit rien', async () => {
      const services = await create()
      await services.setPackEnabled('demo', false)
      expect(services.config.config.modules).toEqual({})
    })

    it('conserve position et échelle des modules déjà personnalisés', async () => {
      const services = await create()
      await services.setModulePlacement('demo/bar', { scale: 2 })
      await services.setPackEnabled('demo', true)
      expect(services.config.config.modules['demo/bar']).toMatchObject({ enabled: true, scale: 2 })
    })

    it('refuse un pack inconnu', async () => {
      const services = await create()
      await expect(services.setPackEnabled('inconnu', true)).rejects.toThrow('Pack introuvable')
    })
  })

  describe('adjustSession', () => {
    it('corrige les compteurs, prévient le client et renvoie la session', async () => {
      const services = await create()
      const seen: SessionState[] = []
      services.onSession((s) => seen.push(s))

      const session = services.adjustSession({ wins: 12, losses: 3, streak: 4 })

      expect(session).toMatchObject({ wins: 12, losses: 3, streak: 4, bestStreak: 4 })
      expect(seen).toHaveLength(1)
      expect(services.getState().session).toMatchObject({ wins: 12, losses: 3 })
    })

    it('ne prévient personne quand rien ne change', async () => {
      const services = await create()
      const seen: SessionState[] = []
      services.onSession((s) => seen.push(s))
      services.adjustSession({})
      expect(seen).toEqual([])
    })

    it('refuse une valeur invalide sans rien modifier', async () => {
      const services = await create()
      expect(() => services.adjustSession({ wins: -2 })).toThrow('Victoires')
      expect(services.getState().session.wins).toBe(0)
    })

    it('la correction reste après un reset puis se remet à zéro', async () => {
      const services = await create()
      services.adjustSession({ wins: 5 })
      services.resetSession()
      expect(services.getState().session.wins).toBe(0)
    })
  })

  describe('écran', () => {
    it('sans fournisseur : un écran 1920 × 1080 par défaut', async () => {
      const services = await create()
      expect(services.getState().display).toEqual({
        id: 0,
        label: 'Principal — 1920 × 1080',
        workArea: { x: 0, y: 0, width: 1920, height: 1080 }
      })
    })

    it('utilise l’écran fourni (Electron)', async () => {
      const display = {
        id: 1,
        label: 'Principal — 2560 × 1440',
        workArea: { x: 0, y: 0, width: 2048, height: 1104 }
      }
      const services = await create(display)
      expect(services.getState().display).toEqual(display)
    })
  })
})
