import { pick, type Language } from './language'
import { COLOR_PATTERN, type ModuleManifest, type SettingDefinition } from './manifest'

/** Valeur d'un réglage : booléen (boolean), nombre (number, range) ou texte (text, color, enum). */
export type SettingValue = boolean | number | string

export type SettingCheck = { ok: true; value: SettingValue } | { ok: false; error: string }

const fail = (error: string): SettingCheck => ({ ok: false, error })

/**
 * Vérifie une valeur contre la définition du manifeste. Le client est notre code, mais la valeur
 * est enregistrée puis envoyée à du code de pack tiers : rien n'est accepté sans contrôle.
 */
export function validateSettingValue(
  def: SettingDefinition,
  value: unknown,
  language: Language = 'fr'
): SettingCheck {
  const t = (fr: string, en: string): string => pick(language, fr, en)
  switch (def.type) {
    case 'boolean':
      return typeof value === 'boolean'
        ? { ok: true, value }
        : fail(t('booléen attendu', 'boolean expected'))

    case 'number':
    case 'range': {
      if (typeof value !== 'number' || !Number.isFinite(value))
        return fail(t('nombre attendu', 'number expected'))
      if (def.min !== undefined && value < def.min)
        return fail(t(`minimum : ${def.min}`, `minimum: ${def.min}`))
      if (def.max !== undefined && value > def.max)
        return fail(t(`maximum : ${def.max}`, `maximum: ${def.max}`))
      return { ok: true, value }
    }

    case 'text': {
      if (typeof value !== 'string') return fail(t('texte attendu', 'text expected'))
      if (def.maxLength !== undefined && value.length > def.maxLength) {
        return fail(t(`${def.maxLength} caractères au plus`, `${def.maxLength} characters at most`))
      }
      return { ok: true, value }
    }

    case 'color':
      return typeof value === 'string' && COLOR_PATTERN.test(value)
        ? { ok: true, value }
        : fail(
            t(
              'couleur attendue au format #rrggbb ou #rrggbbaa',
              'color expected as #rrggbb or #rrggbbaa'
            )
          )

    case 'enum':
      return typeof value === 'string' && def.options.some((o) => o.value === value)
        ? { ok: true, value }
        : fail(t('valeur absente des options', 'value not among the options'))
  }
}

/**
 * Valeurs effectives des réglages d'un module : la valeur enregistrée si elle est valide, sinon
 * la valeur par défaut du manifeste. Une valeur devenue invalide (manifeste modifié depuis) est
 * donc remplacée sans erreur, et un réglage ajouté plus tard reçoit son défaut.
 */
export function resolveSettings(
  module: Pick<ModuleManifest, 'settings'>,
  stored: Record<string, unknown> | undefined
): Record<string, SettingValue> {
  const values: Record<string, SettingValue> = {}
  for (const def of module.settings) {
    const check = stored && def.key in stored ? validateSettingValue(def, stored[def.key]) : null
    values[def.key] = check?.ok ? check.value : def.default
  }
  return values
}
