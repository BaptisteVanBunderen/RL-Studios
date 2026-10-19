import { realpath, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'

export interface ResolvedFile {
  /** Chemin absolu réel (liens symboliques résolus). */
  path: string
  isFile: boolean
  /** Taille en octets. */
  size: number
}

/**
 * Résout un chemin relatif À L'INTÉRIEUR de `root`, ou renvoie `null` s'il est introuvable ou
 * s'il en sort. Les packs d'overlays sont du code tiers : leur manifeste et les URL demandées au
 * serveur ne doivent jamais permettre de lire un fichier hors du dossier du pack.
 *
 * Trois protections :
 * - un segment `..` est refusé (test lexical) ;
 * - le chemin est résolu avec `realpath` : un lien symbolique qui pointe hors du dossier est
 *   refusé après résolution ;
 * - la comparaison se fait sur `racine + séparateur`, pour que `pack-evil` ne passe pas pour un
 *   sous-dossier de `pack`.
 */
export async function resolveInside(
  root: string,
  relative: string | readonly string[]
): Promise<ResolvedFile | null> {
  const segments = (typeof relative === 'string' ? relative.split(/[\\/]/) : relative).filter(
    (s) => s !== '' && s !== '.'
  )
  if (segments.some((s) => s === '..' || s.includes('\0'))) return null

  try {
    const realRoot = await realpath(root)
    const real = await realpath(join(realRoot, ...segments))
    if (real !== realRoot && !real.startsWith(realRoot + sep)) return null
    const info = await stat(real)
    return { path: real, isFile: info.isFile(), size: info.size }
  } catch {
    return null
  }
}
