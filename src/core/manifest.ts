import { z } from 'zod'

/**
 * Manifeste d'un pack d'overlays (`overlays/<pack-id>/manifest.json`), format décrit dans
 * docs/architecture.md. Pur : la lecture du fichier et les vérifications sur disque sont dans
 * PackLoader.
 */

/** Identifiants de pack et de module : minuscules, chiffres, tiret. */
export const ID_PATTERN = /^[a-z0-9-]+$/

export const ANCHORS = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right'
] as const

/** Topics qu'un module peut demander dans `data`. `settings` est toujours envoyé, inutile de le lister. */
export const MANIFEST_TOPICS = ['session', 'match', 'event', 'connection'] as const

/**
 * Chemin relatif sûr : ni vide, ni absolu (`/x`, `\x`, `C:\x`), sans segment `..`. Empêche un
 * manifeste de désigner un fichier hors du dossier de son pack. Ce test est lexical : PackLoader
 * vérifie en plus, sur disque, que le fichier résolu reste dans le pack (liens symboliques).
 */
export function isSafeRelativePath(path: string): boolean {
  if (path === '' || path.includes('\0')) return false
  if (/^[\\/]/.test(path) || /^[a-zA-Z]:/.test(path)) return false
  return !path.split(/[\\/]/).includes('..')
}

const relativePath = z.string().min(1, { error: 'chemin attendu' }).refine(isSafeRelativePath, {
  error: 'chemin relatif attendu, sans « .. » ni chemin absolu'
})

const idSchema = z.string().regex(ID_PATTERN, {
  error: 'identifiant invalide : seuls a-z, 0-9 et - sont autorisés'
})

const semverSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, {
  error: 'version semver attendue (ex. 1.0.0)'
})

const colorSchema = z.string().regex(/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i, {
  error: 'couleur attendue au format #rrggbb ou #rrggbbaa'
})

// -------------------------------------------------------------------------------------------
// Les six types de réglages
// -------------------------------------------------------------------------------------------

const settingBase = {
  key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, {
    error: 'clé invalide : lettres, chiffres et _ (sans commencer par un chiffre)'
  }),
  label: z.string().min(1, { error: 'libellé attendu' }),
  description: z.string().optional()
}

const textSetting = z
  .object({
    ...settingBase,
    type: z.literal('text'),
    default: z.string(),
    maxLength: z.number().int().positive().optional()
  })
  .refine((s) => s.maxLength === undefined || s.default.length <= s.maxLength, {
    error: 'la valeur par défaut dépasse maxLength',
    path: ['default']
  })

const numberSetting = z
  .object({
    ...settingBase,
    type: z.literal('number'),
    default: z.number(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional()
  })
  .refine((s) => s.min === undefined || s.max === undefined || s.min <= s.max, {
    error: 'min doit être inférieur ou égal à max',
    path: ['min']
  })
  .refine(
    (s) =>
      (s.min === undefined || s.default >= s.min) && (s.max === undefined || s.default <= s.max),
    { error: 'la valeur par défaut est hors des bornes min/max', path: ['default'] }
  )

const booleanSetting = z.object({
  ...settingBase,
  type: z.literal('boolean'),
  default: z.boolean()
})

const colorSetting = z.object({
  ...settingBase,
  type: z.literal('color'),
  default: colorSchema
})

const selectSetting = z
  .object({
    ...settingBase,
    type: z.literal('select'),
    default: z.string(),
    options: z
      .array(
        z.object({
          value: z.string(),
          label: z.string().min(1, { error: 'libellé attendu' })
        })
      )
      .min(1, { error: 'au moins une option attendue' })
  })
  .refine((s) => new Set(s.options.map((o) => o.value)).size === s.options.length, {
    error: 'deux options ont la même valeur',
    path: ['options']
  })
  .refine((s) => s.options.some((o) => o.value === s.default), {
    error: 'la valeur par défaut ne fait pas partie des options',
    path: ['default']
  })

const rangeSetting = z
  .object({
    ...settingBase,
    type: z.literal('range'),
    default: z.number(),
    min: z.number(),
    max: z.number(),
    step: z.number().positive().optional()
  })
  .refine((s) => s.min <= s.max, {
    error: 'min doit être inférieur ou égal à max',
    path: ['min']
  })
  .refine((s) => s.default >= s.min && s.default <= s.max, {
    error: 'la valeur par défaut est hors des bornes min/max',
    path: ['default']
  })

const settingSchemas = {
  text: textSetting,
  number: numberSetting,
  boolean: booleanSetting,
  color: colorSetting,
  select: selectSetting,
  range: rangeSetting
} as const

const settingSchema = z.discriminatedUnion('type', [
  textSetting,
  numberSetting,
  booleanSetting,
  colorSetting,
  selectSetting,
  rangeSetting
])

// -------------------------------------------------------------------------------------------
// Module et manifeste
// -------------------------------------------------------------------------------------------

const sizeSchema = z.object({
  width: z.number().int().positive().max(10_000),
  height: z.number().int().positive().max(10_000)
})

export const positionSchema = z.object({
  anchor: z.enum(ANCHORS),
  /** Décalage depuis l'ancre, vers l'intérieur de l'écran, en pixels logiques. */
  x: z.number(),
  y: z.number()
})

const moduleSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1, { error: 'nom attendu' }),
    description: z.string().default(''),
    /** Page d'entrée, relative au dossier du pack. */
    entry: relativePath,
    /** Taille de référence en pixels logiques. */
    size: sizeSchema,
    defaultPosition: positionSchema.default({ anchor: 'top-left', x: 0, y: 0 }),
    data: z.array(z.enum(MANIFEST_TOPICS)).default([]),
    settings: z.array(settingSchema).default([])
  })
  .refine((m) => new Set(m.settings.map((s) => s.key)).size === m.settings.length, {
    error: 'deux réglages ont la même clé',
    path: ['settings']
  })

export const manifestSchema = z
  .object({
    manifestVersion: z.literal(1, { error: 'manifestVersion doit valoir 1' }),
    name: z.string().min(1, { error: 'nom attendu' }),
    description: z.string().default(''),
    author: z.string().default(''),
    version: semverSchema,
    /** Image d'aperçu, relative au dossier du pack. */
    preview: relativePath.optional(),
    modules: z.array(moduleSchema).min(1, { error: 'au moins un module attendu' })
  })
  .refine((m) => new Set(m.modules.map((mod) => mod.id)).size === m.modules.length, {
    error: 'deux modules ont le même identifiant',
    path: ['modules']
  })

export type Manifest = z.output<typeof manifestSchema>
export type ModuleManifest = Manifest['modules'][number]
export type SettingDefinition = ModuleManifest['settings'][number]
export type Anchor = (typeof ANCHORS)[number]
/** Ancre et décalage d'un module (position par défaut du manifeste ou choix de l'utilisateur). */
export type Position = z.output<typeof positionSchema>
export type ManifestTopic = (typeof MANIFEST_TOPICS)[number]

export type ManifestResult =
  { ok: true; manifest: Manifest; warnings: string[] } | { ok: false; errors: string[] }

const frenchErrors = z.locales.fr().localeError

function formatPath(path: readonly PropertyKey[]): string {
  let out = ''
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`
    else out += out === '' ? String(segment) : `.${String(segment)}`
  }
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Clés présentes dans le JSON mais inconnues du format : un avertissement, pas une erreur. */
function findUnknownKeys(raw: unknown): string[] {
  const found: string[] = []

  const check = (value: unknown, known: object, path: string): Record<string, unknown> | null => {
    if (!isRecord(value)) return null
    for (const key of Object.keys(value)) {
      if (!(key in known)) found.push(path === '' ? key : `${path}.${key}`)
    }
    return value
  }

  const root = check(raw, manifestSchema.shape, '')
  const modules = root?.modules
  if (!Array.isArray(modules)) return found

  modules.forEach((m: unknown, i) => {
    const mod = check(m, moduleSchema.shape, `modules[${i}]`)
    if (!mod) return
    check(mod.size, sizeSchema.shape, `modules[${i}].size`)
    check(mod.defaultPosition, positionSchema.shape, `modules[${i}].defaultPosition`)

    if (!Array.isArray(mod.settings)) return
    mod.settings.forEach((s: unknown, j) => {
      const type = isRecord(s) ? s.type : undefined
      if (typeof type === 'string' && type in settingSchemas) {
        const schema = settingSchemas[type as keyof typeof settingSchemas]
        check(s, schema.shape, `modules[${i}].settings[${j}]`)
      }
      // options d'un `select`
      if (isRecord(s) && Array.isArray(s.options)) {
        s.options.forEach((o: unknown, k) =>
          check(o, { value: 0, label: 0 }, `modules[${i}].settings[${j}].options[${k}]`)
        )
      }
    })
  })
  return found
}

/**
 * Valide le contenu (déjà décodé) d'un manifest.json.
 * Erreurs en français, avec le chemin du champ fautif. Une clé inconnue donne un avertissement.
 */
export function parseManifest(raw: unknown): ManifestResult {
  const result = manifestSchema.safeParse(raw, { error: frenchErrors })
  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const path = formatPath(issue.path)
      return path === '' ? issue.message : `${path} : ${issue.message}`
    })
    return { ok: false, errors }
  }
  const warnings = findUnknownKeys(raw).map((path) => `${path} : clé inconnue (ignorée)`)
  return { ok: true, manifest: result.data, warnings }
}

/** Valeurs par défaut des réglages d'un module : `{ clé: valeur }`. */
export function settingDefaults(module: ModuleManifest): Record<string, unknown> {
  return Object.fromEntries(module.settings.map((s) => [s.key, s.default]))
}
