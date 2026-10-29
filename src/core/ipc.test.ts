import { describe, expect, it } from 'vitest'
import { IPC_EVENTS, IPC_INVOKE, setModuleEnabledArgs, toPacksSnapshot } from './ipc'
import { parseManifest } from './manifest'
import type { LoadedPack, PackScan } from './packs'

function pack(id: string, over: Record<string, unknown> = {}): LoadedPack {
  const result = parseManifest({
    manifestVersion: 1,
    name: `Pack ${id}`,
    version: '1.0.0',
    author: 'moi',
    preview: 'preview.png',
    modules: [
      {
        id: 'bar',
        name: 'Barre',
        entry: 'bar.html',
        size: { width: 100, height: 40 },
        data: ['session'],
        settings: [{ key: 'on', type: 'boolean', label: 'Actif', default: true }]
      },
      { id: 'score', name: 'Score', entry: 'score.html', size: { width: 200, height: 80 } }
    ],
    ...over
  })
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return { id, dir: `C:\\secret\\${id}`, manifest: result.manifest, warnings: ['un avertissement'] }
}

describe('toPacksSnapshot', () => {
  const scan: PackScan = {
    packs: [pack('alpha')],
    invalid: [{ id: 'casse', dir: 'C:\\secret\\casse', errors: ['manifest.json introuvable'] }]
  }

  it('résume chaque pack et chaque module', () => {
    const snapshot = toPacksSnapshot(scan, { modules: {} })
    expect(snapshot.packs).toHaveLength(1)
    expect(snapshot.packs[0]).toMatchObject({
      id: 'alpha',
      name: 'Pack alpha',
      author: 'moi',
      version: '1.0.0',
      preview: 'preview.png',
      warnings: ['un avertissement']
    })
    expect(snapshot.packs[0].modules.map((m) => m.key)).toEqual(['alpha/bar', 'alpha/score'])
    expect(snapshot.packs[0].modules[0]).toMatchObject({
      id: 'bar',
      size: { width: 100, height: 40 },
      data: ['session'],
      settings: [{ key: 'on', type: 'boolean' }]
    })
  })

  it('reporte l’état d’activation depuis la config ; inactif par défaut', () => {
    const snapshot = toPacksSnapshot(scan, { modules: { 'alpha/bar': { enabled: true } } })
    expect(snapshot.packs[0].modules.map((m) => m.enabled)).toEqual([true, false])
  })

  it('un module activé dans la config mais disparu du pack n’apparaît pas', () => {
    const snapshot = toPacksSnapshot(scan, { modules: { 'alpha/fantome': { enabled: true } } })
    expect(snapshot.packs[0].modules.map((m) => m.key)).toEqual(['alpha/bar', 'alpha/score'])
  })

  it('liste les packs invalides avec leurs erreurs', () => {
    expect(toPacksSnapshot(scan, { modules: {} }).invalid).toEqual([
      { id: 'casse', errors: ['manifest.json introuvable'] }
    ])
  })

  it('ne laisse fuiter aucun chemin absolu (le résultat traverse l’IPC)', () => {
    expect(JSON.stringify(toPacksSnapshot(scan, { modules: {} }))).not.toContain('secret')
  })

  it('est sérialisable en JSON sans perte', () => {
    const snapshot = toPacksSnapshot(scan, { modules: { 'alpha/bar': { enabled: true } } })
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
  })

  it('un preview absent donne null', () => {
    const noPreview: PackScan = { packs: [pack('b', { preview: undefined })], invalid: [] }
    expect(toPacksSnapshot(noPreview, { modules: {} }).packs[0].preview).toBeNull()
  })
})

describe('setModuleEnabledArgs', () => {
  it('accepte [clé de module, booléen]', () => {
    expect(setModuleEnabledArgs.safeParse(['session-tracker/bar', true]).success).toBe(true)
  })

  it.each([
    [['pas valide', true]],
    [['pack/module/extra', true]],
    [['../../etc/passwd', true]],
    [['pack/bar', 'oui']],
    [['pack/bar']],
    [[]],
    [['pack/bar', true, 'en trop']]
  ])('refuse %j', (args) => {
    expect(setModuleEnabledArgs.safeParse(args).success).toBe(false)
  })
})

describe('canaux IPC', () => {
  it('les noms de canaux sont tous distincts', () => {
    const all = [...Object.values(IPC_INVOKE), ...Object.values(IPC_EVENTS)]
    expect(new Set(all).size).toBe(all.length)
  })
})
