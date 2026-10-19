import { describe, expect, it } from 'vitest'
import { isSafeRelativePath, parseManifest, settingDefaults } from './manifest'

/** Manifeste de référence de docs/architecture.md (les six types de réglages). */
function valid(): Record<string, unknown> {
  return {
    manifestVersion: 1,
    name: 'Session Tracker',
    description: 'Victoires, défaites et séries en temps réel',
    author: 'THEVBAT',
    version: '1.0.0',
    preview: 'preview.png',
    modules: [
      {
        id: 'bar',
        name: 'Session Bar',
        description: 'Winrate, victoires, défaites, série, meilleure série',
        entry: 'modules/bar.html',
        size: { width: 425, height: 48 },
        defaultPosition: { anchor: 'top-right', x: 20, y: 0 },
        data: ['session'],
        settings: [
          { key: 'showBest', type: 'boolean', label: 'Afficher la meilleure série', default: true },
          { key: 'winColor', type: 'color', label: 'Couleur des victoires', default: '#4cdb8a' },
          {
            key: 'bgOpacity',
            type: 'range',
            label: 'Opacité du fond',
            min: 0,
            max: 1,
            step: 0.05,
            default: 0.93
          },
          {
            key: 'goodWinrate',
            type: 'number',
            label: 'Winrate « vert » à partir de (%)',
            min: 0,
            max: 100,
            default: 60
          },
          { key: 'title', type: 'text', label: 'Titre', default: '', maxLength: 24 },
          {
            key: 'streakIcon',
            type: 'select',
            label: 'Icône de série',
            default: 'fire',
            options: [
              { value: 'fire', label: 'Feu' },
              { value: 'bolt', label: 'Éclair' }
            ]
          }
        ]
      }
    ]
  }
}

type Mutable = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Applique une modification au manifeste valide et renvoie les erreurs (ou `[]` si accepté). */
function errorsAfter(change: (m: Mutable) => void): string[] {
  const m = valid() as Mutable
  change(m)
  const result = parseManifest(m)
  return result.ok ? [] : result.errors
}

const firstModule = (m: Mutable): Mutable => m.modules[0]
const setting = (m: Mutable, key: string): Mutable =>
  firstModule(m).settings.find((s: Mutable) => s.key === key)

describe('parseManifest : cas valides', () => {
  it('accepte le manifeste de référence, sans erreur ni avertissement', () => {
    const result = parseManifest(valid())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warnings).toEqual([])
      expect(result.manifest.modules[0].settings).toHaveLength(6)
      expect(result.manifest.modules[0].defaultPosition).toEqual({
        anchor: 'top-right',
        x: 20,
        y: 0
      })
    }
  })

  it('remplit les valeurs par défaut d’un manifeste minimal', () => {
    const result = parseManifest({
      manifestVersion: 1,
      name: 'Minimal',
      version: '0.1.0',
      modules: [{ id: 'a', name: 'A', entry: 'a.html', size: { width: 100, height: 50 } }]
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest).toMatchObject({ description: '', author: '' })
    expect(result.manifest.preview).toBeUndefined()
    expect(result.manifest.modules[0]).toMatchObject({
      description: '',
      data: [],
      settings: [],
      defaultPosition: { anchor: 'top-left', x: 0, y: 0 }
    })
  })

  it('accepte les neuf ancres et les quatre topics', () => {
    for (const anchor of [
      'top-left',
      'top',
      'top-right',
      'left',
      'center',
      'right',
      'bottom-left',
      'bottom',
      'bottom-right'
    ]) {
      expect(errorsAfter((m) => (firstModule(m).defaultPosition.anchor = anchor))).toEqual([])
    }
    expect(
      errorsAfter((m) => (firstModule(m).data = ['session', 'match', 'event', 'connection']))
    ).toEqual([])
  })

  it('accepte une couleur avec transparence et une version avec suffixe', () => {
    expect(errorsAfter((m) => (setting(m, 'winColor').default = '#4CDB8A80'))).toEqual([])
    expect(errorsAfter((m) => (m.version = '1.2.3-beta.1'))).toEqual([])
  })
})

describe('parseManifest : erreurs, en français et avec le chemin du champ', () => {
  it('refuse ce qui n’est pas un objet', () => {
    for (const raw of [null, 42, 'texte', [], undefined]) {
      expect(parseManifest(raw).ok).toBe(false)
    }
  })

  it('manifestVersion doit valoir 1', () => {
    expect(errorsAfter((m) => (m.manifestVersion = 2))).toEqual([
      'manifestVersion : manifestVersion doit valoir 1'
    ])
    expect(errorsAfter((m) => delete m.manifestVersion)).toHaveLength(1)
  })

  it('exige un nom, une version semver et au moins un module', () => {
    expect(errorsAfter((m) => (m.name = ''))[0]).toContain('name')
    expect(errorsAfter((m) => (m.version = '1.0'))[0]).toContain('version semver')
    expect(errorsAfter((m) => (m.modules = []))).toEqual(['modules : au moins un module attendu'])
  })

  it('donne un message français pour un type incorrect', () => {
    const [error] = errorsAfter((m) => (m.name = 42))
    expect(error).toMatch(/^name : /)
    expect(error).toContain('nombre')
  })

  it('refuse un identifiant de module invalide et des identifiants en double', () => {
    expect(errorsAfter((m) => (firstModule(m).id = 'Ma Barre'))[0]).toContain('modules[0].id')
    expect(
      errorsAfter((m) => m.modules.push({ ...firstModule(m) })) // même id « bar »
    ).toEqual(['modules : deux modules ont le même identifiant'])
  })

  it('refuse une taille nulle, négative ou non entière', () => {
    expect(errorsAfter((m) => (firstModule(m).size.width = 0))[0]).toContain(
      'modules[0].size.width'
    )
    expect(errorsAfter((m) => (firstModule(m).size.height = -5))).toHaveLength(1)
    expect(errorsAfter((m) => (firstModule(m).size.width = 10.5))).toHaveLength(1)
  })

  it('refuse une ancre ou un topic inconnu', () => {
    expect(errorsAfter((m) => (firstModule(m).defaultPosition.anchor = 'milieu'))[0]).toContain(
      'modules[0].defaultPosition.anchor'
    )
    expect(errorsAfter((m) => (firstModule(m).data = ['events']))[0]).toContain(
      'modules[0].data[0]'
    )
  })

  it('refuse un type de réglage inconnu', () => {
    expect(
      errorsAfter((m) => firstModule(m).settings.push({ key: 'x', type: 'date', label: 'X' }))
    ).toHaveLength(1)
  })

  it('refuse une clé de réglage en double ou invalide', () => {
    expect(errorsAfter((m) => firstModule(m).settings.push({ ...setting(m, 'showBest') }))).toEqual(
      ['modules[0].settings : deux réglages ont la même clé']
    )
    expect(errorsAfter((m) => (setting(m, 'showBest').key = '1abc'))[0]).toContain(
      'modules[0].settings[0].key'
    )
  })

  it('range : bornes cohérentes et défaut dans les bornes', () => {
    expect(errorsAfter((m) => (setting(m, 'bgOpacity').min = 5))).toContain(
      'modules[0].settings[2].min : min doit être inférieur ou égal à max'
    )
    expect(errorsAfter((m) => (setting(m, 'bgOpacity').default = 2))).toEqual([
      'modules[0].settings[2].default : la valeur par défaut est hors des bornes min/max'
    ])
    expect(errorsAfter((m) => delete setting(m, 'bgOpacity').max)).toHaveLength(1) // max obligatoire
  })

  it('number : bornes facultatives, défaut dans les bornes', () => {
    expect(errorsAfter((m) => (setting(m, 'goodWinrate').default = 150))).toHaveLength(1)
    expect(
      errorsAfter((m) => {
        delete setting(m, 'goodWinrate').min
        delete setting(m, 'goodWinrate').max
        setting(m, 'goodWinrate').default = 9999
      })
    ).toEqual([])
  })

  it('text : le défaut ne dépasse pas maxLength', () => {
    expect(errorsAfter((m) => (setting(m, 'title').default = 'x'.repeat(25)))).toEqual([
      'modules[0].settings[4].default : la valeur par défaut dépasse maxLength'
    ])
  })

  it('color : #rrggbb ou #rrggbbaa uniquement', () => {
    for (const bad of ['red', '#fff', '4cdb8a', '#12345', '#gggggg']) {
      expect(errorsAfter((m) => (setting(m, 'winColor').default = bad))).toHaveLength(1)
    }
  })

  it('select : défaut parmi les options, options non vides et sans doublon', () => {
    expect(errorsAfter((m) => (setting(m, 'streakIcon').default = 'etoile'))).toEqual([
      'modules[0].settings[5].default : la valeur par défaut ne fait pas partie des options'
    ])
    expect(errorsAfter((m) => (setting(m, 'streakIcon').options = []))[0]).toContain(
      'au moins une option'
    )
    expect(
      errorsAfter((m) => setting(m, 'streakIcon').options.push({ value: 'fire', label: 'Encore' }))
    ).toEqual(['modules[0].settings[5].options : deux options ont la même valeur'])
  })

  it('signale toutes les erreurs d’un coup, pas seulement la première', () => {
    const errors = errorsAfter((m) => {
      m.name = ''
      m.version = 'x'
      firstModule(m).size.width = 0
    })
    expect(errors.length).toBeGreaterThanOrEqual(3)
  })
})

describe('chemins : entry et preview ne sortent jamais du pack', () => {
  const bad = [
    '../secret.html',
    'a/../../b.html',
    '..\\secret.html',
    '/etc/passwd',
    '\\\\serveur\\x',
    'C:\\x.html',
    'c:/x.html',
    ''
  ]
  const good = [
    'bar.html',
    'modules/bar.html',
    'modules\\bar.html',
    './bar.html',
    'a/b/c.html',
    'fichier..html',
    '.cache/x.html'
  ]

  it.each(bad)('isSafeRelativePath refuse %j', (path) => {
    expect(isSafeRelativePath(path)).toBe(false)
  })
  it.each(good)('isSafeRelativePath accepte %j', (path) => {
    expect(isSafeRelativePath(path)).toBe(true)
  })

  it('le manifeste refuse un entry ou un preview dangereux', () => {
    expect(errorsAfter((m) => (firstModule(m).entry = '../../autre/x.html'))[0]).toContain(
      'modules[0].entry'
    )
    expect(errorsAfter((m) => (m.preview = '/etc/passwd'))[0]).toContain('preview')
  })

  it('refuse un octet nul', () => {
    expect(isSafeRelativePath('a\0.html')).toBe(false)
  })
})

describe('clés inconnues : avertissement, jamais erreur', () => {
  it('signale chaque clé inconnue avec son chemin', () => {
    const m = valid() as Mutable
    m.extra = 1
    firstModule(m).couleur = 'rouge'
    firstModule(m).size.depth = 3
    firstModule(m).defaultPosition.z = 1
    setting(m, 'showBest').tooltip = 'x'
    setting(m, 'streakIcon').options[0].icon = 'y'

    const result = parseManifest(m)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([
      'extra : clé inconnue (ignorée)',
      'modules[0].couleur : clé inconnue (ignorée)',
      'modules[0].size.depth : clé inconnue (ignorée)',
      'modules[0].defaultPosition.z : clé inconnue (ignorée)',
      'modules[0].settings[0].tooltip : clé inconnue (ignorée)',
      'modules[0].settings[5].options[0].icon : clé inconnue (ignorée)'
    ])
  })

  it('ne confond pas une clé valide d’un autre type de réglage avec une clé inconnue', () => {
    // `maxLength` est valide pour `text` mais inconnu pour `boolean`
    const m = valid() as Mutable
    setting(m, 'showBest').maxLength = 5
    const result = parseManifest(m)
    expect(result.ok && result.warnings).toEqual([
      'modules[0].settings[0].maxLength : clé inconnue (ignorée)'
    ])
  })

  it('les clés inconnues ne sont pas conservées dans le manifeste validé', () => {
    const m = valid() as Mutable
    m.extra = 1
    const result = parseManifest(m)
    expect(result.ok && 'extra' in result.manifest).toBe(false)
  })
})

describe('settingDefaults', () => {
  it('renvoie { clé: valeur par défaut } pour chaque réglage', () => {
    const result = parseManifest(valid())
    if (!result.ok) throw new Error('manifeste de référence invalide')
    expect(settingDefaults(result.manifest.modules[0])).toEqual({
      showBest: true,
      winColor: '#4cdb8a',
      bgOpacity: 0.93,
      goodWinrate: 60,
      title: '',
      streakIcon: 'fire'
    })
  })

  it('un module sans réglage donne un objet vide', () => {
    const m = valid() as Mutable
    delete firstModule(m).settings
    const result = parseManifest(m)
    expect(result.ok && settingDefaults(result.manifest.modules[0])).toEqual({})
  })
})
