import type { Manifest } from './manifest'

/** Pack dont le manifeste est valide et dont les fichiers existent. */
export interface LoadedPack {
  /** Nom du dossier. */
  id: string
  /** Chemin absolu du dossier du pack. */
  dir: string
  manifest: Manifest
  /** Avertissements non bloquants (clé inconnue, aperçu introuvable…). */
  warnings: string[]
}

/** Dossier de `overlays/` qui n'a pas pu être chargé : il est listé avec ses erreurs. */
export interface InvalidPack {
  id: string
  dir: string
  errors: string[]
}

export interface PackScan {
  packs: LoadedPack[]
  invalid: InvalidPack[]
}

const MODULE_KEY = /^([a-z0-9-]+)\/([a-z0-9-]+)$/

/** Identifiant d'un module dans la config et le client : `<pack>/<module>`. */
export function moduleKey(packId: string, moduleId: string): string {
  return `${packId}/${moduleId}`
}

export function parseModuleKey(key: string): { packId: string; moduleId: string } | null {
  const match = MODULE_KEY.exec(key)
  return match ? { packId: match[1], moduleId: match[2] } : null
}

export function isModuleKey(key: string): boolean {
  return MODULE_KEY.test(key)
}
