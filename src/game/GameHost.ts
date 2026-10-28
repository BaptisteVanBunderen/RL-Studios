import { execFile } from 'node:child_process'
import { join } from 'node:path'
import type { GameInstall, GameLauncher } from '@core/index'
import { detectInstalls } from './GameSetup'

/**
 * Tout ce qui touche au système autour du jeu (processus, boutiques, lancement). Derrière une
 * interface pour que `Services` reste testable sans lancer ni fermer le vrai jeu.
 */
export interface GameHost {
  detectInstalls(): Promise<GameInstall[]>
  isRunning(): Promise<boolean>
  /** Demande la fermeture du jeu et attend qu'il soit parti ; lève une erreur au-delà du délai. */
  closeGame(): Promise<void>
  launch(launcher: GameLauncher): Promise<void>
}

/** Hôte inactif : jeu jamais lancé, aucune installation. Valeur par défaut (tests). */
export const nullGameHost: GameHost = {
  detectInstalls: async () => [],
  isRunning: async () => false,
  closeGame: async () => {},
  launch: async () => {
    throw new Error('Lancement du jeu indisponible')
  }
}

export const GAME_PROCESS = 'RocketLeague.exe'
const STEAM_APP_ID = 252950

export const LAUNCH_URLS: Record<GameLauncher, string> = {
  steam: `steam://rungameid/${STEAM_APP_ID}`,
  // « Sugar » est le nom de code de Rocket League dans Epic Games
  epic: 'com.epicgames.launcher://apps/Sugar?action=launch&silent=true'
}

type Run = (file: string, args: string[]) => Promise<string>

const run: Run = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 10_000 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout)
    )
  })

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface WindowsGameHostOptions {
  /** Ouvre une URL avec l'application associée (`shell.openExternal` d'Electron). */
  openExternal: (url: string) => Promise<void>
  env?: NodeJS.ProcessEnv
  exec?: Run
  closeTimeoutMs?: number
}

export function createGameHost(options: WindowsGameHostOptions): GameHost {
  const exec = options.exec ?? run
  const env = options.env ?? process.env
  const closeTimeout = options.closeTimeoutMs ?? 15_000
  const windows = process.platform === 'win32'

  const isRunning = async (): Promise<boolean> => {
    if (!windows) return false
    try {
      const out = await exec('tasklist', [
        '/FI',
        `IMAGENAME eq ${GAME_PROCESS}`,
        '/FO',
        'CSV',
        '/NH'
      ])
      return out.toLowerCase().includes(GAME_PROCESS.toLowerCase())
    } catch {
      return false
    }
  }

  const steamRoots = async (): Promise<string[]> => {
    const roots: string[] = []
    if (windows) {
      try {
        const out = await exec('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'])
        const match = /SteamPath\s+REG_SZ\s+(.+)/i.exec(out)
        if (match) roots.push(match[1].trim().replace(/\//g, '\\'))
      } catch {
        /* Steam non installé */
      }
    }
    const x86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    roots.push(join(x86, 'Steam'))
    return roots
  }

  return {
    detectInstalls: async () =>
      detectInstalls({
        steamRoots: await steamRoots(),
        epicManifest: join(
          env['ProgramData'] ?? 'C:\\ProgramData',
          'Epic',
          'UnrealEngineLauncher',
          'LauncherInstalled.dat'
        ),
        fallbackDirs: [
          join(env['ProgramFiles'] ?? 'C:\\Program Files', 'Epic Games', 'rocketleague')
        ]
      }),

    isRunning,

    async closeGame() {
      if (!(await isRunning())) return
      // Sans /F : demande de fermeture normale, comme le bouton de la fenêtre.
      await exec('taskkill', ['/IM', GAME_PROCESS]).catch(() => undefined)
      const deadline = Date.now() + closeTimeout
      while (Date.now() < deadline) {
        await sleep(500)
        if (!(await isRunning())) return
      }
      throw new Error('Le jeu ne se ferme pas : ferme-le toi-même puis réessaie.')
    },

    launch: (launcher) => options.openExternal(LAUNCH_URLS[launcher])
  }
}
