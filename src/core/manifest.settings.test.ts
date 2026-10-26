import { describe, expect, it } from 'vitest'
import { parseManifest, type ModuleManifest } from './manifest'

type Mutable = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Manifeste minimal dont le module porte les réglages donnés. */
function withSettings(...settings: Mutable[]): Mutable {
  return {
    manifestVersion: 1,
    name: 'P',
    version: '1.0.0',
    modules: [{ id: 'm', name: 'M', entry: 'm.html', size: { width: 10, height: 10 }, settings }]
  }
}

function settingsOf(
  raw: Mutable
): { ok: true; settings: ModuleManifest['settings'] } | { ok: false; errors: string[] } {
  const result = parseManifest(raw)
  return result.ok
    ? { ok: true, settings: result.manifest.modules[0].settings }
    : { ok: false, errors: result.errors }
}

describe('réglage de type enum', () => {
  it('accepte des options en chaînes, comme dans la maquette', () => {
    const r = settingsOf(
      withSettings({
        key: 'density',
        type: 'enum',
        label: 'Densité',
        options: ['compacte', 'large'],
        default: 'compacte'
      })
    )
    expect(r.ok && r.settings[0]).toMatchObject({
      type: 'enum',
      options: [
        { value: 'compacte', label: 'Compacte' },
        { value: 'large', label: 'Large' }
      ],
      default: 'compacte'
    })
  })

  it('accepte des options en objets { value, label }', () => {
    const r = settingsOf(
      withSettings({
        key: 'icon',
        type: 'enum',
        label: 'Icône',
        options: [
          { value: 'fire', label: 'Feu' },
          { value: 'bolt', label: 'Éclair' }
        ],
        default: 'fire'
      })
    )
    expect(r.ok && r.settings[0]).toMatchObject({
      options: [
        { value: 'fire', label: 'Feu' },
        { value: 'bolt', label: 'Éclair' }
      ]
    })
  })

  it('accepte un mélange de chaînes et d’objets', () => {
    const r = settingsOf(
      withSettings({
        key: 'k',
        type: 'enum',
        label: 'K',
        options: ['a', { value: 'b', label: 'Beta' }],
        default: 'a'
      })
    )
    expect(r.ok && r.settings[0]).toMatchObject({
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'Beta' }
      ]
    })
  })

  it('`select` reste accepté comme alias, et ressort sous le nom `enum`', () => {
    const r = settingsOf(
      withSettings({
        key: 'k',
        type: 'select',
        label: 'K',
        options: ['x', 'y'],
        default: 'y'
      })
    )
    expect(r.ok && r.settings[0].type).toBe('enum')
  })

  it.each([
    ['option qui n’est ni chaîne ni objet', [1, 2], 'x'],
    ['défaut absent des options', ['a', 'b'], 'c'],
    ['options en double (même valeur)', ['a', 'a'], 'a'],
    ['aucune option', [], 'a'],
    ['chaîne vide', ['', 'b'], 'b']
  ])('refuse : %s', (_nom, options, def) => {
    const r = settingsOf(
      withSettings({ key: 'k', type: 'enum', label: 'K', options, default: def })
    )
    expect(r.ok).toBe(false)
  })

  it('le libellé d’une option objet reste tel quel (pas de majuscule forcée)', () => {
    const r = settingsOf(
      withSettings({
        key: 'k',
        type: 'enum',
        label: 'K',
        options: [{ value: 'a', label: 'déjà écrit' }],
        default: 'a'
      })
    )
    expect(r.ok && r.settings[0]).toMatchObject({ options: [{ label: 'déjà écrit' }] })
  })

  it('les clés inconnues d’une option sont signalées avec le bon chemin', () => {
    const raw = withSettings({
      key: 'k',
      type: 'select',
      label: 'K',
      options: [{ value: 'a', label: 'A', icone: 'x' }],
      default: 'a'
    })
    const result = parseManifest(raw)
    expect(result.ok && result.warnings).toEqual([
      'modules[0].settings[0].options[0].icone : clé inconnue (ignorée)'
    ])
  })
})

describe('réglage de type color : palette', () => {
  const color = (extra: Mutable = {}): Mutable => ({
    key: 'accent',
    type: 'color',
    label: 'Accent',
    default: '#3B9CE0',
    ...extra
  })

  it('accepte une palette de couleurs', () => {
    const r = settingsOf(withSettings(color({ palette: ['#3B9CE0', '#E96F22', '#A78BFA80'] })))
    expect(r.ok && r.settings[0]).toMatchObject({ palette: ['#3B9CE0', '#E96F22', '#A78BFA80'] })
  })

  it('la palette est facultative, et le défaut peut ne pas en faire partie (valeur libre)', () => {
    expect(settingsOf(withSettings(color())).ok).toBe(true)
    expect(settingsOf(withSettings(color({ palette: ['#E96F22'] }))).ok).toBe(true)
  })

  it.each([
    ['couleur invalide', ['rouge']],
    ['palette vide', []],
    ['trop de couleurs', Array.from({ length: 13 }, () => '#112233')],
    ['pas un tableau', '#112233']
  ])('refuse : %s', (_nom, palette) => {
    expect(settingsOf(withSettings(color({ palette }))).ok).toBe(false)
  })

  it('`palette` est inconnue pour un autre type de réglage (avertissement)', () => {
    const result = parseManifest(
      withSettings({ key: 'k', type: 'boolean', label: 'K', default: true, palette: ['#112233'] })
    )
    expect(result.ok && result.warnings).toEqual([
      'modules[0].settings[0].palette : clé inconnue (ignorée)'
    ])
  })
})

describe('unité des réglages range et number', () => {
  it('accepte une unité sur un range et sur un number', () => {
    const r = settingsOf(
      withSettings(
        { key: 'a', type: 'range', label: 'A', min: 0, max: 100, default: 82, unit: '%' },
        { key: 'b', type: 'number', label: 'B', default: 12, unit: 'px' }
      )
    )
    expect(r.ok && r.settings).toMatchObject([{ unit: '%' }, { unit: 'px' }])
  })

  it('l’unité est facultative', () => {
    expect(
      settingsOf(withSettings({ key: 'a', type: 'range', label: 'A', min: 0, max: 1, default: 0 }))
        .ok
    ).toBe(true)
  })

  it.each(['', 'beaucoup trop long', 12])('refuse l’unité %j', (unit) => {
    expect(
      settingsOf(
        withSettings({ key: 'a', type: 'range', label: 'A', min: 0, max: 1, default: 0, unit })
      ).ok
    ).toBe(false)
  })

  it('l’unité est inconnue pour un booléen (avertissement)', () => {
    const result = parseManifest(
      withSettings({ key: 'k', type: 'boolean', label: 'K', default: true, unit: '%' })
    )
    expect(result.ok && result.warnings).toEqual([
      'modules[0].settings[0].unit : clé inconnue (ignorée)'
    ])
  })
})

describe('la forme canonique ne dépend pas de l’écriture', () => {
  it('chaînes + select, ou objets + enum : même résultat', () => {
    const a = settingsOf(
      withSettings({ key: 'k', type: 'select', label: 'K', options: ['a', 'b'], default: 'a' })
    )
    const b = settingsOf(
      withSettings({
        key: 'k',
        type: 'enum',
        label: 'K',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' }
        ],
        default: 'a'
      })
    )
    expect(a).toEqual(b)
  })

  it('ne modifie pas l’objet reçu', () => {
    const raw = withSettings({ key: 'k', type: 'select', label: 'K', options: ['a'], default: 'a' })
    const copy = JSON.parse(JSON.stringify(raw))
    parseManifest(raw)
    expect(raw).toEqual(copy)
  })
})
