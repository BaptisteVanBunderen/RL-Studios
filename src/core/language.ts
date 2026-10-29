export const LANGUAGES = ['fr', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

export const DEFAULT_LANGUAGE: Language = 'fr'

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

/** Le texte dans la langue demandée (messages d'erreur construits côté code). */
export function pick(language: Language, fr: string, en: string): string {
  return language === 'en' ? en : fr
}

/** Langue d'après la locale du système (`fr`, `fr-FR`, `en-US`…) : français, sinon anglais. */
export function detectLanguage(locale: string | null | undefined): Language {
  return /^fr([-_]|$)/i.test(locale ?? '') ? 'fr' : 'en'
}
