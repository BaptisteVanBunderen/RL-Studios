import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveInside } from './safePath'

describe('resolveInside', () => {
  let base: string
  let root: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'rl-studio-safe-'))
    root = join(base, 'pack')
    await mkdir(join(root, 'modules'), { recursive: true })
    await writeFile(join(root, 'modules', 'bar.html'), '<html></html>')
    await writeFile(join(root, 'style.css'), 'a{}')
    // Un voisin dont le nom commence comme le dossier du pack, avec un fichier « secret ».
    await mkdir(join(base, 'pack-evil'), { recursive: true })
    await writeFile(join(base, 'pack-evil', 'secret.txt'), 'secret')
    await writeFile(join(base, 'secret.txt'), 'secret')
  })
  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('résout un fichier du pack (chemin texte, / ou \\, ou liste de segments)', async () => {
    const a = await resolveInside(root, 'modules/bar.html')
    const b = await resolveInside(root, 'modules\\bar.html')
    const c = await resolveInside(root, ['modules', 'bar.html'])
    expect(a?.isFile).toBe(true)
    expect(b?.path).toBe(a?.path)
    expect(c?.path).toBe(a?.path)
  })

  it('ignore les segments vides et « . »', async () => {
    const r = await resolveInside(root, './modules//./bar.html')
    expect(r?.isFile).toBe(true)
  })

  it('distingue fichier et dossier', async () => {
    expect((await resolveInside(root, 'modules'))?.isFile).toBe(false)
    expect((await resolveInside(root, ''))?.isFile).toBe(false) // la racine elle-même
  })

  it('renvoie null pour un fichier absent', async () => {
    expect(await resolveInside(root, 'absent.html')).toBeNull()
    expect(await resolveInside(join(base, 'inexistant'), 'x')).toBeNull()
  })

  it.each([
    '../secret.txt',
    'modules/../../secret.txt',
    '..\\secret.txt',
    '../pack-evil/secret.txt',
    'modules/..'
  ])('refuse la sortie du dossier : %s', async (path) => {
    expect(await resolveInside(root, path)).toBeNull()
  })

  it('refuse un segment « .. » même fourni sous forme de liste', async () => {
    expect(await resolveInside(root, ['..', 'secret.txt'])).toBeNull()
  })

  it('refuse un octet nul', async () => {
    expect(await resolveInside(root, 'style.css\0.png')).toBeNull()
  })

  it('un chemin absolu est traité comme relatif au pack, jamais comme absolu', async () => {
    // « / » initial ignoré : on cherche root/<...>, pas la racine du disque
    expect(await resolveInside(root, join(base, 'secret.txt'))).toBeNull()
  })

  it('refuse un lien symbolique qui sort du dossier (ignoré si la plateforme l’interdit)', async () => {
    try {
      await symlink(join(base, 'secret.txt'), join(root, 'lien.txt'), 'file')
    } catch {
      return // droits insuffisants (Windows sans mode développeur) : on ne peut pas tester
    }
    expect(await resolveInside(root, 'lien.txt')).toBeNull()
  })

  it('accepte un lien symbolique qui reste dans le pack (ignoré si la plateforme l’interdit)', async () => {
    try {
      await symlink(join(root, 'style.css'), join(root, 'alias.css'), 'file')
    } catch {
      return
    }
    expect((await resolveInside(root, 'alias.css'))?.isFile).toBe(true)
  })
})
