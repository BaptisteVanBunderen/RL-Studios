import { z } from 'zod'
import { isModuleKey } from './packs'

/**
 * Valeurs par défaut des ports. Elles sont aussi codées dans OverlayServer et GameConnection
 * (qui ne peuvent pas dépendre de ce module sans l'inverse) : un test les compare.
 */
export const DEFAULT_OVERLAY_PORT = 49200
export const DEFAULT_GAME_PORT = 49124

/** Réglages d'un module. P3 y ajoutera position et échelle, P4 les valeurs de réglages. */
export interface ModuleConfig {
  enabled: boolean
}

export interface AppConfig {
  version: number
  /** Port du serveur d'overlays (127.0.0.1). */
  overlayPort: number
  /** Port WebSocket de la Stats API du jeu (`WebPort` du fichier TAStatsAPI.ini). */
  gameWebPort: number
  /** `PrimaryId` du joueur local, mémorisé après l'avoir vu désigné par `Game.Target`. */
  localPlayerId: string | null
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
  localPlayerId: z.string().min(1).nullable().catch(null)
})

const moduleSchema = z.looseObject({ enabled: z.boolean().catch(false) })

export function defaultConfig(): AppConfig {
  return {
    version: 1,
    overlayPort: DEFAULT_OVERLAY_PORT,
    gameWebPort: DEFAULT_GAME_PORT,
    localPlayerId: null,
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
