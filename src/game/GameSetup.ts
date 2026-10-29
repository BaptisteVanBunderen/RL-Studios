import { access, copyFile, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  applyStatsApiIni,
  pick,
  type Language,
  launcherFromPath,
  parseStatsApiIni,
  type GameInstall,
  type StatsApiChange,
  type StatsApiIni
} from '@core/index'

/** Dossier d'installation Steam du jeu : `<bibliothèque>\steamapps\common\rocketleague`. */
const STEAM_FOLDER = join('steamapps', 'common', 'rocketleague')
const CONFIG_DIR = join('TAGame', 'Config')
const INI_NAMES = ['TAStatsAPI.ini', 'DefaultStatsAPI.ini']
const BACKUP_SUFFIX = '.rlstudio.bak'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Un dossier est une installation de Rocket League s'il contient `TAGame\Config`. */
export async function isGameDir(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, CONFIG_DIR))).isDirectory()
  } catch {
    return false
  }
}

export async function toInstall(dir: string): Promise<GameInstall | null> {
  return (await isGameDir(dir)) ? { dir, launcher: launcherFromPath(dir) } : null
}

/** Chemins `"path"  "D:\\Steam"` du fichier `libraryfolders.vdf` de Steam. */
export function parseSteamLibraries(vdf: string): string[] {
  const paths: string[] = []
  for (const match of vdf.matchAll(/"path"\s+"([^"]+)"/gi)) {
    paths.push(match[1].replace(/\\\\/g, '\\'))
  }
  return paths
}

/** Installations Epic : `LauncherInstalled.dat` liste les jeux (Rocket League = « Sugar »). */
export function parseEpicManifest(json: string): string[] {
  try {
    const data: unknown = JSON.parse(json)
    const list = (data as { InstallationList?: unknown }).InstallationList
    if (!Array.isArray(list)) return []
    return list
      .filter((entry): entry is { AppName?: string; InstallLocation: string } => {
        const e = entry as { AppName?: unknown; InstallLocation?: unknown }
        return (
          typeof e?.InstallLocation === 'string' &&
          (e.AppName === 'Sugar' || /rocket\s?league/i.test(e.InstallLocation))
        )
      })
      .map((entry) => entry.InstallLocation)
  } catch {
    return []
  }
}

export interface DetectSources {
  /** Dossiers racine de Steam (registre, chemin par défaut). */
  steamRoots: string[]
  /** Chemin de `LauncherInstalled.dat`. */
  epicManifest: string
  /** Emplacements usuels essayés en dernier recours. */
  fallbackDirs: string[]
}

/** Cherche l'installation du jeu (Steam et Epic) ; ne renvoie que des dossiers valides, sans doublon. */
export async function detectInstalls(sources: DetectSources): Promise<GameInstall[]> {
  const candidates: string[] = []

  for (const root of sources.steamRoots) {
    candidates.push(join(root, STEAM_FOLDER))
    try {
      const vdf = await readFile(join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8')
      for (const library of parseSteamLibraries(vdf)) candidates.push(join(library, STEAM_FOLDER))
    } catch {
      /* Steam absent ou fichier illisible : on passe à la suite */
    }
  }

  try {
    const dat = await readFile(sources.epicManifest, 'utf8')
    candidates.push(...parseEpicManifest(dat))
  } catch {
    /* Epic absent */
  }

  candidates.push(...sources.fallbackDirs)

  const found: GameInstall[] = []
  const seen = new Set<string>()
  for (const dir of candidates) {
    const key = dir.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const install = await toInstall(dir)
    if (install) found.push(install)
  }
  return found
}

// --- fichier ini de la Stats API ----------------------------------------------------------------

/** `TAStatsAPI.ini` s'il existe, sinon `DefaultStatsAPI.ini` (docs/stats-api.md). */
export async function locateIni(gameDir: string): Promise<string | null> {
  for (const name of INI_NAMES) {
    const path = join(gameDir, CONFIG_DIR, name)
    if (await exists(path)) return path
  }
  return null
}

export async function readStatsApiIni(gameDir: string): Promise<StatsApiIni> {
  const path = await locateIni(gameDir)
  if (!path) return { found: false }
  const settings = parseStatsApiIni(await readFile(path, 'utf8'))
  return {
    found: true,
    path,
    settings,
    enabled: (settings.packetSendRate ?? 0) > 0,
    hasBackup: await exists(path + BACKUP_SUFFIX)
  }
}

/**
 * Modifie l'ini après avoir sauvegardé l'original UNE fois (`<fichier>.rlstudio.bak`) : les
 * modifications suivantes ne l'écrasent pas, pour qu'il reste le fichier d'avant RL Studio.
 */
export async function writeStatsApiIni(
  gameDir: string,
  change: StatsApiChange,
  language: Language = 'fr'
): Promise<StatsApiIni> {
  const path = await locateIni(gameDir)
  if (!path) {
    throw new Error(
      pick(
        language,
        "Fichier de configuration de l'API introuvable dans TAGame\\Config.",
        'API configuration file not found in TAGame\\Config.'
      )
    )
  }

  const backup = path + BACKUP_SUFFIX
  try {
    if (!(await exists(backup))) await copyFile(path, backup)
    await writeFile(path, applyStatsApiIni(await readFile(path, 'utf8'), change), 'utf8')
  } catch (error) {
    throw new Error(explainFsError(error, path, language))
  }
  return readStatsApiIni(gameDir)
}

export async function restoreStatsApiIni(
  gameDir: string,
  language: Language = 'fr'
): Promise<StatsApiIni> {
  const path = await locateIni(gameDir)
  if (!path || !(await exists(path + BACKUP_SUFFIX))) {
    throw new Error(pick(language, 'Aucune sauvegarde à restaurer.', 'No backup to restore.'))
  }
  try {
    await copyFile(path + BACKUP_SUFFIX, path)
  } catch (error) {
    throw new Error(explainFsError(error, path, language))
  }
  return readStatsApiIni(gameDir)
}

function explainFsError(error: unknown, path: string, language: Language): string {
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'EPERM' || code === 'EACCES') {
    return pick(
      language,
      `Écriture refusée dans ${path} : relance RL Studio en administrateur, ou autorise l'écriture dans ce dossier.`,
      `Write denied in ${path}: restart RL Studio as administrator, or allow writing in that folder.`
    )
  }
  const reason = error instanceof Error ? error.message : String(error)
  return pick(
    language,
    `Impossible de modifier ${path} : ${reason}`,
    `Cannot modify ${path}: ${reason}`
  )
}
