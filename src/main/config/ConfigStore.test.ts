import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigStore } from './ConfigStore'

describe('ConfigStore', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rl-studio-config-'))
    file = join(dir, 'config.json')
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  })

  const read = async (): Promise<Record<string, unknown>> =>
    JSON.parse(await readFile(file, 'utf8'))

  describe('load', () => {
    it('fichier absent : valeurs par défaut, sans erreur ni création de fichier', async () => {
      const store = new ConfigStore(file)
      expect(store.load()).toEqual({ recovered: false })
      expect(store.config).toMatchObject({ overlayPort: 49200, gameWebPort: 49124, modules: {} })
      expect(await readdir(dir)).toEqual([])
    })

    it('relit une config enregistrée', async () => {
      await writeFile(
        file,
        JSON.stringify({
          overlayPort: 50000,
          localPlayerId: 'Epic|abc|0',
          modules: { 'p/m': { enabled: true } }
        })
      )
      const store = new ConfigStore(file)
      store.load()
      expect(store.config).toMatchObject({
        overlayPort: 50000,
        localPlayerId: 'Epic|abc|0',
        modules: { 'p/m': { enabled: true } }
      })
    })

    it('répare champ par champ un fichier modifié à la main', async () => {
      await writeFile(file, JSON.stringify({ overlayPort: 'abc', localPlayerId: 'Epic|abc|0' }))
      const store = new ConfigStore(file)
      expect(store.load()).toEqual({ recovered: false })
      expect(store.config).toMatchObject({ overlayPort: 49200, localPlayerId: 'Epic|abc|0' })
    })

    it('accepte un fichier UTF-8 avec BOM', async () => {
      await writeFile(file, '﻿' + JSON.stringify({ overlayPort: 50001 }))
      const store = new ConfigStore(file)
      expect(store.load()).toEqual({ recovered: false })
      expect(store.config.overlayPort).toBe(50001)
    })

    it('fichier corrompu : défauts, copie .bak, et signalé par `recovered`', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await writeFile(file, '{ "overlayPort": 5000')
      const store = new ConfigStore(file)
      expect(store.load()).toEqual({ recovered: true })
      expect(store.config.overlayPort).toBe(49200)
      expect(await readFile(`${file}.bak`, 'utf8')).toBe('{ "overlayPort": 5000')
    })

    it('un fichier JSON mais pas un objet (ex. un tableau) redevient les défauts sans planter', async () => {
      await writeFile(file, '[1, 2, 3]')
      const store = new ConfigStore(file)
      store.load()
      expect(store.config.overlayPort).toBe(49200)
    })
  })

  describe('update', () => {
    it('modifie la config en mémoire et l’écrit sur disque', async () => {
      const store = new ConfigStore(file)
      store.load()
      await store.update((c) => {
        c.localPlayerId = 'Epic|abc|0'
        c.modules['p/m'] = { enabled: true }
      })
      expect(store.config.localPlayerId).toBe('Epic|abc|0')
      expect(await read()).toMatchObject({
        localPlayerId: 'Epic|abc|0',
        modules: { 'p/m': { enabled: true } }
      })
    })

    it('crée le dossier s’il n’existe pas', async () => {
      const nested = join(dir, 'a', 'b', 'config.json')
      const store = new ConfigStore(nested)
      await store.update((c) => {
        c.overlayPort = 50002
      })
      expect(JSON.parse(await readFile(nested, 'utf8')).overlayPort).toBe(50002)
    })

    it('permet de renvoyer un nouvel objet plutôt que de modifier sur place', async () => {
      const store = new ConfigStore(file)
      store.load()
      await store.update((c) => ({ ...c, overlayPort: 50003 }))
      expect(store.config.overlayPort).toBe(50003)
    })

    it('ne laisse aucun fichier temporaire derrière lui', async () => {
      const store = new ConfigStore(file)
      await store.update((c) => {
        c.overlayPort = 50004
      })
      expect(await readdir(dir)).toEqual(['config.json'])
    })

    it('le fichier écrit est du JSON lisible, terminé par un saut de ligne', async () => {
      const store = new ConfigStore(file)
      await store.update(() => {})
      const text = await readFile(file, 'utf8')
      expect(text.endsWith('\n')).toBe(true)
      expect(text).toContain('\n  "overlayPort": 49200')
    })

    it('ce qui est écrit se relit à l’identique', async () => {
      const a = new ConfigStore(file)
      await a.update((c) => {
        c.localPlayerId = 'Epic|abc|0'
        c.overlayPort = 50005
        c.modules['x/y'] = { enabled: true }
      })
      const b = new ConfigStore(file)
      b.load()
      expect(b.config).toEqual(a.config)
    })

    it('des mises à jour rapprochées sont toutes écrites, dans l’ordre', async () => {
      const store = new ConfigStore(file)
      store.load()
      const done = [1, 2, 3, 4, 5].map((n) =>
        store.update((c) => {
          c.modules[`p/m${n}`] = { enabled: true }
        })
      )
      await Promise.all(done)
      expect(Object.keys((await read()).modules as object)).toEqual([
        'p/m1',
        'p/m2',
        'p/m3',
        'p/m4',
        'p/m5'
      ])
    })

    it('conserve les clés inconnues déjà présentes dans le fichier', async () => {
      await writeFile(file, JSON.stringify({ hotkey: 'F9' }))
      const store = new ConfigStore(file)
      store.load()
      await store.update((c) => {
        c.overlayPort = 50006
      })
      expect(await read()).toMatchObject({ hotkey: 'F9', overlayPort: 50006 })
    })

    it('une écriture impossible ne plante pas et ne bloque pas les suivantes', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      // Le « fichier » est un dossier : l'écriture échoue.
      await mkdir(file)
      const store = new ConfigStore(file)
      await expect(store.update((c) => void (c.overlayPort = 50007))).resolves.toBeUndefined()
      expect(store.config.overlayPort).toBe(50007) // la mémoire est à jour malgré l'échec

      await rm(file, { recursive: true })
      await store.update((c) => void (c.overlayPort = 50008))
      expect((await read()).overlayPort).toBe(50008)
    })

    it('ne modifie pas la config si la fonction plante', async () => {
      const store = new ConfigStore(file)
      store.load()
      expect(() =>
        store.update(() => {
          throw new Error('boum')
        })
      ).toThrow('boum')
      expect(store.config.overlayPort).toBe(49200)
    })
  })

  describe('onChange et flush', () => {
    it('prévient à chaque modification, avec la nouvelle config', async () => {
      const store = new ConfigStore(file)
      const seen: number[] = []
      store.onChange((c) => seen.push(c.overlayPort))
      await store.update((c) => void (c.overlayPort = 50010))
      await store.update((c) => void (c.overlayPort = 50011))
      expect(seen).toEqual([50010, 50011])
    })

    it('flush attend les écritures en cours', async () => {
      const store = new ConfigStore(file)
      void store.update((c) => void (c.overlayPort = 50012)) // volontairement non attendu
      await store.flush()
      expect((await read()).overlayPort).toBe(50012)
    })

    it('flush sans rien à écrire se résout tout de suite', async () => {
      await expect(new ConfigStore(file).flush()).resolves.toBeUndefined()
    })
  })
})
