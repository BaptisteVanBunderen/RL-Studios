import { describe, expect, it } from 'vitest'
import { parseConfig } from './config'
import { detectLanguage, isLanguage, pick } from './language'
import { validateSettingValue } from './settings'
import { SessionStore } from './session'

describe('langue', () => {
  it('détecte le français d’après la locale du système, sinon l’anglais', () => {
    for (const locale of ['fr', 'fr-FR', 'fr_CA', 'FR-be'])
      expect(detectLanguage(locale)).toBe('fr')
    for (const locale of ['en-US', 'de-DE', 'es', 'frisian', '', null, undefined]) {
      expect(detectLanguage(locale)).toBe('en')
    }
  })

  it('reconnaît les langues gérées', () => {
    expect(isLanguage('fr') && isLanguage('en')).toBe(true)
    expect(isLanguage('de')).toBe(false)
    expect(isLanguage(null)).toBe(false)
  })

  it('choisit le texte de la langue demandée', () => {
    expect(pick('fr', 'Bonjour', 'Hello')).toBe('Bonjour')
    expect(pick('en', 'Bonjour', 'Hello')).toBe('Hello')
  })

  it('est enregistrée dans la config ; une valeur inconnue redevient « non choisie »', () => {
    expect(parseConfig({ language: 'en' }).language).toBe('en')
    expect(parseConfig({ language: 'klingon' }).language).toBeNull()
    expect(parseConfig({}).language).toBeNull()
  })

  it('les messages de validation existent dans les deux langues', () => {
    const def = { key: 'n', type: 'number', label: 'N', min: 0, max: 10, default: 5 } as const
    expect(validateSettingValue(def, 99, 'fr')).toEqual({ ok: false, error: 'maximum : 10' })
    expect(validateSettingValue(def, 99, 'en')).toEqual({ ok: false, error: 'maximum: 10' })
    expect(validateSettingValue(def, 'x', 'en')).toEqual({ ok: false, error: 'number expected' })
  })

  it('les erreurs de correction de session existent dans les deux langues', () => {
    const store = new SessionStore()
    expect(() => store.adjust({ wins: -1 })).toThrow(/Victoires/)
    expect(() => store.adjust({ wins: -1 }, 'en')).toThrow(/Wins/)
  })
})
