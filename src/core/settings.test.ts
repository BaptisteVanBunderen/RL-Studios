import { describe, expect, it } from 'vitest'
import { parseManifest, type ModuleManifest, type SettingDefinition } from './manifest'
import { resolveSettings, validateSettingValue } from './settings'

/** Les six types de réglages, tels que le manifeste les valide. */
const manifest = parseManifest({
  manifestVersion: 1,
  name: 'P',
  version: '1.0.0',
  modules: [
    {
      id: 'm',
      name: 'M',
      entry: 'm.html',
      size: { width: 10, height: 10 },
      settings: [
        { key: 'show', type: 'boolean', label: 'S', default: true },
        { key: 'goal', type: 'number', label: 'G', default: 5, min: 0, max: 10 },
        { key: 'free', type: 'number', label: 'F', default: 3 },
        { key: 'opacity', type: 'range', label: 'O', min: 0, max: 1, step: 0.05, default: 0.8 },
        { key: 'title', type: 'text', label: 'T', default: 'Hi', maxLength: 5 },
        { key: 'accent', type: 'color', label: 'A', default: '#3B9CE0' },
        {
          key: 'density',
          type: 'enum',
          label: 'D',
          options: ['compacte', 'large'],
          default: 'compacte'
        }
      ]
    }
  ]
})
if (!manifest.ok) throw new Error(manifest.errors.join('\n'))
const module: ModuleManifest = manifest.manifest.modules[0]
const def = (key: string): SettingDefinition => module.settings.find((s) => s.key === key)!

describe('validateSettingValue', () => {
  it.each([
    ['show', false],
    ['goal', 0],
    ['goal', 10],
    ['goal', 4.5],
    ['free', -9999],
    ['opacity', 0.35],
    ['title', ''],
    ['title', 'abcde'],
    ['accent', '#112233'],
    ['accent', '#11223344'],
    ['density', 'large']
  ])('accepte %s = %j', (key, value) => {
    expect(validateSettingValue(def(key), value)).toEqual({ ok: true, value })
  })

  it.each([
    ['show', 'true'],
    ['show', 1],
    ['goal', 11],
    ['goal', -1],
    ['goal', '5'],
    ['goal', NaN],
    ['goal', Infinity],
    ['free', null],
    ['opacity', 1.01],
    ['title', 'abcdef'],
    ['title', 12],
    ['accent', 'red'],
    ['accent', '#fff'],
    ['accent', 12],
    ['density', 'Large'],
    ['density', 'inconnue'],
    ['density', 1]
  ])('refuse %s = %j', (key, value) => {
    const check = validateSettingValue(def(key), value)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.error).toBeTruthy()
  })

  it('les erreurs sont en français et précisent la contrainte', () => {
    expect(validateSettingValue(def('goal'), 11)).toEqual({ ok: false, error: 'maximum : 10' })
    expect(validateSettingValue(def('goal'), -1)).toEqual({ ok: false, error: 'minimum : 0' })
    expect(validateSettingValue(def('title'), 'abcdef')).toEqual({
      ok: false,
      error: '5 caractères au plus'
    })
  })
})

describe('resolveSettings', () => {
  it('sans valeurs enregistrées : les défauts du manifeste', () => {
    expect(resolveSettings(module, undefined)).toEqual({
      show: true,
      goal: 5,
      free: 3,
      opacity: 0.8,
      title: 'Hi',
      accent: '#3B9CE0',
      density: 'compacte'
    })
  })

  it('une valeur enregistrée valide remplace le défaut', () => {
    expect(resolveSettings(module, { show: false, density: 'large', opacity: 0.5 })).toMatchObject({
      show: false,
      density: 'large',
      opacity: 0.5,
      goal: 5 // non enregistré : défaut
    })
  })

  it('une valeur enregistrée devenue invalide est remplacée par le défaut, sans erreur', () => {
    expect(
      resolveSettings(module, { goal: 999, density: 'disparue', accent: 'rouge' })
    ).toMatchObject({
      goal: 5,
      density: 'compacte',
      accent: '#3B9CE0'
    })
  })

  it('ignore les valeurs de réglages qui n’existent plus', () => {
    const values = resolveSettings(module, { ancien: 1, show: false })
    expect('ancien' in values).toBe(false)
    expect(values.show).toBe(false)
  })

  it('un module sans réglage donne un objet vide', () => {
    expect(resolveSettings({ settings: [] }, { x: 1 })).toEqual({})
  })

  it('ne modifie pas ses arguments', () => {
    const stored = { show: false }
    resolveSettings(module, stored)
    expect(stored).toEqual({ show: false })
  })
})
