import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PackLoader } from './PackLoader'

type Mutable = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function manifest(over: Mutable = {}): Mutable {
  return {
    manifestVersion: 1,
    name: 'Pack de test',
    version: '1.0.0',
    modules: [
      {
        id: 'bar',
        name: 'Barre',
        entry: 'modules/bar.html',
        size: { width: 100, height: 40 }
      }
    ],
    ...over
  }
}

describe('PackLoader', () => {
  let root: string

  /** Crée overlays/<id>/ avec son manifeste (objet → JSON, chaîne → tel quel) et des fichiers. */
  async function pack(
    id: string,
    content: Mutable | string | null = manifest(),
    files: string[] = ['modules/bar.html']
  ): Promise<string> {
    const dir = join(root, id)
    await mkdir(dir, { recursive: true })
    if (content !== null) {
      await writeFile(
        join(dir, 'manifest.json'),
        typeof content === 'string' ? content : JSON.stringify(content)
      )
    }
    for (const file of files) {
      await mkdir(dirname(join(dir, file)), { recursive: true })
      await writeFile(join(dir, file), '<html></html>')
    }
    return dir
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'rl-studio-packs-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  describe('scan', () => {
    it('un dossier absent donne un résultat vide, sans exception', async () => {
      const loader = new PackLoader(join(root, 'inexistant'))
      expect(await loader.scan()).toEqual({ packs: [], invalid: [] })
    })

    it('un dossier vide donne un résultat vide', async () => {
      expect(await new PackLoader(root).scan()).toEqual({ packs: [], invalid: [] })
    })

    it('charge un pack valide : l’identifiant est le nom du dossier', async () => {
      const dir = await pack('session-tracker')
      const { packs, invalid } = await new PackLoader(root).scan()
      expect(invalid).toEqual([])
      expect(packs).toHaveLength(1)
      expect(packs[0]).toMatchObject({ id: 'session-tracker', dir, warnings: [] })
      expect(packs[0].manifest.name).toBe('Pack de test')
    })

    it('ignore les fichiers et les dossiers cachés à la racine', async () => {
      await writeFile(join(root, '.gitkeep'), '')
      await writeFile(join(root, 'notes.txt'), 'x')
      await mkdir(join(root, '.git'))
      await pack('ok')
      const { packs, invalid } = await new PackLoader(root).scan()
      expect(packs.map((p) => p.id)).toEqual(['ok'])
      expect(invalid).toEqual([])
    })

    it('trie les packs par identifiant', async () => {
      await pack('zeta')
      await pack('alpha')
      await pack('milieu')
      const { packs } = await new PackLoader(root).scan()
      expect(packs.map((p) => p.id)).toEqual(['alpha', 'milieu', 'zeta'])
    })

    it('un pack cassé n’empêche pas les autres de se charger', async () => {
      await pack('bon')
      await pack('casse', '{ pas du json')
      await pack('autre-bon')
      const { packs, invalid } = await new PackLoader(root).scan()
      expect(packs.map((p) => p.id)).toEqual(['autre-bon', 'bon'])
      expect(invalid.map((p) => p.id)).toEqual(['casse'])
    })
  })

  describe('identifiant = nom du dossier', () => {
    it.each(['Ma Pack', 'PACK', 'pack_1', 'été', 'a.b'])(
      'refuse le dossier « %s »',
      async (name) => {
        await pack(name)
        const { packs, invalid } = await new PackLoader(root).scan()
        expect(packs).toEqual([])
        expect(invalid).toHaveLength(1)
        expect(invalid[0].id).toBe(name)
        expect(invalid[0].errors[0]).toContain('nom de dossier invalide')
      }
    )

    it('accepte lettres minuscules, chiffres et tirets', async () => {
      await pack('mon-pack-2')
      expect((await new PackLoader(root).scan()).packs).toHaveLength(1)
    })
  })

  describe('manifest.json', () => {
    it('manifeste introuvable', async () => {
      await pack('sans-manifeste', null)
      const { invalid } = await new PackLoader(root).scan()
      expect(invalid[0].errors).toEqual(['manifest.json introuvable'])
    })

    it('manifest.json est un dossier', async () => {
      await mkdir(join(root, 'etrange', 'manifest.json'), { recursive: true })
      const { invalid } = await new PackLoader(root).scan()
      expect(invalid[0].errors).toEqual(['manifest.json n’est pas un fichier'])
    })

    it('JSON illisible', async () => {
      await pack('casse', '{ "name": ')
      const { invalid } = await new PackLoader(root).scan()
      expect(invalid[0].errors[0]).toContain('manifest.json illisible')
    })

    it('accepte un manifeste enregistré en UTF-8 avec BOM (éditeurs Windows)', async () => {
      await pack('avec-bom', '﻿' + JSON.stringify(manifest()))
      const { packs, invalid } = await new PackLoader(root).scan()
      expect(invalid).toEqual([])
      expect(packs).toHaveLength(1)
    })

    it('refuse un manifeste de plus de 1 Mo', async () => {
      await pack('enorme', JSON.stringify(manifest({ description: 'x'.repeat(1024 * 1024 + 1) })))
      const { invalid } = await new PackLoader(root).scan()
      expect(invalid[0].errors).toEqual(['manifest.json trop volumineux (> 1 Mo)'])
    })

    it('liste toutes les erreurs du manifeste, avec leur chemin', async () => {
      await pack('invalide', manifest({ name: '', version: 'x' }))
      const { invalid } = await new PackLoader(root).scan()
      expect(invalid[0].errors.length).toBeGreaterThanOrEqual(2)
      expect(invalid[0].errors.join('\n')).toContain('name')
      expect(invalid[0].errors.join('\n')).toContain('version')
    })

    it('une clé inconnue est un avertissement : le pack est chargé', async () => {
      await pack('avec-extra', manifest({ extra: true }))
      const { packs, invalid } = await new PackLoader(root).scan()
      expect(invalid).toEqual([])
      expect(packs[0].warnings).toEqual(['extra : clé inconnue (ignorée)'])
    })
  })

  describe('fichiers du pack', () => {
    it('l’entry doit exister', async () => {
      await pack('sans-page', manifest(), [])
      const { invalid } = await new PackLoader(root).scan()
      expect(invalid[0].errors).toEqual([
        'modules[0].entry : fichier introuvable dans le pack (modules/bar.html)'
      ])
    })

    it('l’entry doit être un fichier, pas un dossier', async () => {
      await pack('entry-dossier', manifest(), [])
      await mkdir(join(root, 'entry-dossier', 'modules', 'bar.html'), { recursive: true })
      const { invalid } = await new PackLoader(root).scan()
      expect(invalid[0].errors[0]).toContain('modules[0].entry')
    })

    it('signale chaque module dont la page manque', async () => {
      const m = manifest({
        modules: [
          { id: 'a', name: 'A', entry: 'a.html', size: { width: 10, height: 10 } },
          { id: 'b', name: 'B', entry: 'b.html', size: { width: 10, height: 10 } },
          { id: 'c', name: 'C', entry: 'c.html', size: { width: 10, height: 10 } }
        ]
      })
      await pack('trois', m, ['b.html'])
      const { invalid } = await new PackLoader(root).scan()
      expect(invalid[0].errors.map((e) => e.slice(0, 16))).toEqual([
        'modules[0].entry',
        'modules[2].entry'
      ])
    })

    it('refuse un entry qui sort du pack (« .. »), même si le fichier existe', async () => {
      await writeFile(join(root, 'secret.html'), 'secret')
      await pack(
        'evade',
        manifest({
          modules: [
            { id: 'a', name: 'A', entry: '../secret.html', size: { width: 10, height: 10 } }
          ]
        }),
        []
      )
      const { packs, invalid } = await new PackLoader(root).scan()
      expect(packs).toEqual([])
      expect(invalid[0].errors[0]).toContain('modules[0].entry')
    })

    it('refuse un entry qui est un lien symbolique vers l’extérieur (ignoré si interdit)', async () => {
      await writeFile(join(root, 'secret.html'), 'secret')
      await pack('lien', manifest(), [])
      try {
        await mkdir(join(root, 'lien', 'modules'), { recursive: true })
        await symlink(join(root, 'secret.html'), join(root, 'lien', 'modules', 'bar.html'), 'file')
      } catch {
        return // droits insuffisants pour créer un lien symbolique : rien à tester ici
      }
      const { packs, invalid } = await new PackLoader(root).scan()
      expect(packs).toEqual([])
      expect(invalid[0].errors[0]).toContain('modules[0].entry')
    })

    it('un preview introuvable est un avertissement, pas une erreur', async () => {
      await pack('apercu', manifest({ preview: 'preview.png' }))
      const { packs } = await new PackLoader(root).scan()
      expect(packs).toHaveLength(1)
      expect(packs[0].warnings).toEqual(['preview : fichier introuvable (preview.png)'])
    })

    it('un preview présent ne donne aucun avertissement', async () => {
      await pack('apercu-ok', manifest({ preview: 'preview.png' }), [
        'modules/bar.html',
        'preview.png'
      ])
      expect((await new PackLoader(root).scan()).packs[0].warnings).toEqual([])
    })
  })

  describe('rechargement', () => {
    it('getPack ne renvoie que les packs valides, result garde le dernier scan', async () => {
      await pack('bon')
      await pack('casse', '{')
      const loader = new PackLoader(root)
      expect(loader.getPack('bon')).toBeUndefined() // pas encore scanné
      await loader.scan()
      expect(loader.getPack('bon')?.id).toBe('bon')
      expect(loader.getPack('casse')).toBeUndefined()
      expect(loader.getPack('inconnu')).toBeUndefined()
      expect(loader.result.packs).toHaveLength(1)
      expect(loader.result.invalid).toHaveLength(1)
    })

    it('un nouveau scan voit les ajouts, les corrections et les suppressions', async () => {
      const loader = new PackLoader(root)
      await pack('a')
      await pack('b', '{')
      await loader.scan()
      expect(loader.result.packs.map((p) => p.id)).toEqual(['a'])

      await pack('c') // ajouté
      await pack('b') // réparé
      await rm(join(root, 'a'), { recursive: true }) // supprimé
      await loader.scan()
      expect(loader.result.packs.map((p) => p.id)).toEqual(['b', 'c'])
      expect(loader.result.invalid).toEqual([])
      expect(loader.getPack('a')).toBeUndefined()
    })
  })
})
