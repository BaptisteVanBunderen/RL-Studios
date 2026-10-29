import { z } from 'zod'
import { isValidAccelerator } from './accelerator'
import { LANGUAGES, type Language } from './language'
import { positionSchema, type Position } from './manifest'
import { isModuleKey } from './packs'

/**
 * Valeurs par défaut des ports. Elles sont aussi codées dans OverlayServer et GameConnection
 * (qui ne peuvent pas dépendre de ce module sans l'inverse) : un test les compare.
 */
export const DEFAULT_OVERLAY_PORT = 49200
export const DEFAULT_GAME_PORT = 49124

export const DEFAULT_SHORTCUT = 'Ctrl+Shift+F9'

/** Bornes de l'échelle d'un overlay (1 = taille de référence du manifeste). */
export const MIN_SCALE = 0.25
export const MAX_SCALE = 4

/**
 * Réglages d'un module. `position` et `scale` absents = ceux du manifeste / 1.
 * P4 y ajoutera les valeurs des réglages déclarés dans le manifeste.
 */
export interface ModuleConfig {
  enabled: boolean
  /** Position choisie par l'utilisateur (ancre + décalage en pixels logiques). */
  position?: Position
  /** Échelle choisie par l'utilisateur ; les proportions du module sont toujours conservées. */
  scale?: number
  /** Valeurs des réglages déclarés par le module (validées à la lecture, voir `resolveSettings`). */
  settings?: Record<string, unknown>
}

export interface AppConfig {
  version: number
  /** Port du serveur d'overlays (127.0.0.1). */
  overlayPort: number
  /** Port WebSocket de la Stats API du jeu (`WebPort` du fichier TAStatsAPI.ini). */
  gameWebPort: number
  /** `PrimaryId` du joueur local, mémorisé après l'avoir vu désigné par `Game.Target`. */
  localPlayerId: string | null
  /** Dossier d'installation de Rocket League choisi (détecté ou saisi à la main). */
  gameDir: string | null
  /** Langue de l'interface ; `null` tant que l'utilisateur n'a pas choisi (langue du système). */
  language: Language | null
  /** Écran des overlays (`id` d'Electron) ; `null` = écran principal. */
  displayId: number | null
  /** Raccourci global pour afficher / masquer les overlays (format Electron) ; `null` = aucun. */
  shortcut: string | null
  /** Par clé de module `<pack>/<module>`. */
  modules: Record<string, ModuleConfig>
}

/** Un port utilisable sans droits particuliers ; toute autre valeur redevient le défaut. */
const port = (fallback: number): z.ZodCatch<z.ZodNumber> =>
  z.number().int().min(1024).max(65535).catch(fallback)

const baseSchema = z.object({
  version: z.number().int().catch(1),
  overlayPort: port(DEFAULT_OVERLAY_PORT),
  gameWebPort: port(DEFAULT_GAME_PORT),
  localPlayerId: z.string().min(1).nullable().catch(null),
  gameDir: z.string().min(1).max(1024).nullable().catch(null),
  language: z.enum(LANGUAGES).nullable().catch(null),
  displayId: z.number().int().nullable().catch(null),
  shortcut: z.string().refine(isValidAccelerator).nullable().catch(DEFAULT_SHORTCUT)
})

// Un champ invalide est simplement ignoré (retour au défaut), sans perdre le reste du module.
const moduleSchema = z.looseObject({
  enabled: z.boolean().catch(false),
  position: positionSchema.optional().catch(undefined),
  scale: z.number().min(MIN_SCALE).max(MAX_SCALE).optional().catch(undefined),
  settings: z.record(z.string(), z.unknown()).optional().catch(undefined)
})

export function defaultConfig(): AppConfig {
  return {
    version: 1,
    overlayPort: DEFAULT_OVERLAY_PORT,
    gameWebPort: DEFAULT_GAME_PORT,
    localPlayerId: null,
    gameDir: null,
    language: null,
    displayId: null,
    shortcut: DEFAULT_SHORTCUT,
    modules: {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Lit une config décodée, sans jamais lever d'exception : chaque champ invalide ou manquant
 * redevient sa valeur par défaut, sans perdre les autres (un fichier modifié à la main ne doit
 * pas effacer les réglages d'un utilisateur). Les clés inconnues sont conservées : une version
 * plus récente de l'application ne perd rien en repassant par une plus ancienne.
 */
export function parseConfig(raw: unknown): AppConfig {
  const input = isRecord(raw) ? raw : {}
  const base = baseSchema.parse(input)

  const modules: Record<string, ModuleConfig> = {}
  if (isRecord(input.modules)) {
    for (const [key, value] of Object.entries(input.modules)) {
      if (!isModuleKey(key)) continue
      modules[key] = moduleSchema.parse(isRecord(value) ? value : {})
    }
  }

  const extras = Object.fromEntries(Object.entries(input).filter(([k]) => !(k in base)))
  return { ...extras, ...base, modules }
}
