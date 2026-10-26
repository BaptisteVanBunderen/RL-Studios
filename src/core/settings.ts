import { COLOR_PATTERN, type ModuleManifest, type SettingDefinition } from './manifest'

/** Valeur d'un réglage : booléen (boolean), nombre (number, range) ou texte (text, color, enum). */
export type SettingValue = boolean | number | string

export type SettingCheck = { ok: true; value: SettingValue } | { ok: false; error: string }

const fail = (error: string): SettingCheck => ({ ok: false, error })

/**
 * Vérifie une valeur contre la définition du manifeste. Le client est notre code, mais la valeur
 * est enregistrée puis envoyée à du code de pack tiers : rien n'est accepté sans contrôle.
 */
export function validateSettingValue(def: SettingDefinition, value: unknown): SettingCheck {
  switch (def.type) {
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true, value } : fail('booléen attendu')

    case 'number':
    case 'range': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fail('nombre attendu')
      if (def.min !== undefined && value < def.min) return fail(`minimum : ${def.min}`)
      if (def.max !== undefined && value > def.max) return fail(`maximum : ${def.max}`)
      return { ok: true, value }
    }

    case 'text': {
      if (typeof value !== 'string') return fail('texte attendu')
      if (def.maxLength !== undefined && value.length > def.maxLength) {
        return fail(`${def.maxLength} caractères au plus`)
      }
      return { ok: true, value }
    }

    case 'color':
      return typeof value === 'string' && COLOR_PATTERN.test(value)
        ? { ok: true, value }
        : fail('couleur attendue au format #rrggbb ou #rrggbbaa')

    case 'enum':
      return typeof value === 'string' && def.options.some((o) => o.value === value)
        ? { ok: true, value }
        : fail('valeur absente des options')
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
