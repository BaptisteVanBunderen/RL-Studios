import type { ConnectionStatus } from './protocol'

/** Section du fichier de configuration de la Stats API (voir docs/stats-api.md). */
export const STATS_API_SECTION = 'TAGame.MatchStatsExporter_TA'

export const DEFAULT_PACKET_SEND_RATE = 30
export const MAX_PACKET_SEND_RATE = 120

export type GameLauncher = 'steam' | 'epic'

export interface GameInstall {
  dir: string
  /** Boutique d'origine, déduite du chemin ; `null` si elle ne se reconnaît pas. */
  launcher: GameLauncher | null
}

export interface StatsApiSettings {
  /** Paquets par seconde ; 0 = API désactivée ; `null` = clé absente du fichier. */
  packetSendRate: number | null
  port: number | null
  webPort: number | null
}

export type StatsApiIni =
  | { found: false }
  | {
      found: true
      path: string
      settings: StatsApiSettings
      /** API active : `PacketSendRate` > 0. */
      enabled: boolean
      /** Copie du fichier d'origine faite avant la première modification par RL Studio. */
      hasBackup: boolean
    }

/** Ce que le client affiche dans « Réglages du jeu ». */
export interface GameSetupInfo {
  install: GameInstall | null
  /** Installations trouvées automatiquement (peut en contenir plusieurs). */
  candidates: GameInstall[]
  ini: StatsApiIni
  processRunning: boolean
  /** Trames reçues du jeu par seconde (0 hors connexion). */
  packetsPerSecond: number
  /** Overlays actuellement connectés au serveur local (fenêtres et OBS). */
  overlayClients: number
}

export interface StatsApiChange {
  packetSendRate?: number
}

export function isValidPacketSendRate(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_PACKET_SEND_RATE
  )
}

/** Déduit la boutique du chemin d'installation (Steam : `steamapps`, Epic : `Epic Games`). */
export function launcherFromPath(dir: string): GameLauncher | null {
  const path = dir.toLowerCase()
  if (path.includes('steamapps')) return 'steam'
  if (path.includes('epic')) return 'epic'
  return null
}

/**
 * `connected` dès que le WebSocket est établi ; sinon on distingue un jeu fermé d'un jeu lancé
 * dont l'API n'est pas joignable (ini non configuré, ou modifié sans relance).
 */
export function deriveConnectionStatus(
  linkConnected: boolean,
  processRunning: boolean
): ConnectionStatus {
  if (linkConnected) return 'connected'
  return processRunning ? 'api-disabled' : 'game-closed'
}

// --- fichier ini --------------------------------------------------------------------------------

const SECTION_LINE = /^\s*\[([^\]]*)\]\s*$/
const KEY_LINE = /^\s*([^=;#\s][^=]*?)\s*=\s*(.*?)\s*$/

function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function toInt(value: string | undefined): number | null {
  if (value === undefined || !/^-?\d+$/.test(value)) return null
  return Number(value)
}

/** Lit les trois clés qui nous intéressent dans la section de la Stats API (insensible à la casse). */
export function parseStatsApiIni(text: string): StatsApiSettings {
  const wanted = new Map<string, string>()
  let inSection = false
  for (const line of text.split(/\r?\n/)) {
    const section = SECTION_LINE.exec(line)
    if (section) {
      inSection = section[1].trim().toLowerCase() === STATS_API_SECTION.toLowerCase()
      continue
    }
    if (!inSection) continue
    const key = KEY_LINE.exec(line)
    if (key) wanted.set(key[1].toLowerCase(), key[2])
  }
  return {
    packetSendRate: toInt(wanted.get('packetsendrate')),
    port: toInt(wanted.get('port')),
    webPort: toInt(wanted.get('webport'))
  }
}

/**
 * Renvoie le texte de l'ini avec les clés changées, sans toucher au reste (commentaires, autres
 * sections, fins de ligne). Une clé absente est ajoutée à la fin de sa section ; une section
 * absente est créée en fin de fichier.
 */
export function applyStatsApiIni(text: string, change: StatsApiChange): string {
  const eol = eolOf(text)
  const lines = text === '' ? [] : text.split(/\r?\n/)
  const updates: [string, string][] = []
  if (change.packetSendRate !== undefined) {
    updates.push(['PacketSendRate', String(change.packetSendRate)])
  }

  let start = lines.findIndex((l) => {
    const m = SECTION_LINE.exec(l)
    return m !== null && m[1].trim().toLowerCase() === STATS_API_SECTION.toLowerCase()
  })
  if (start === -1) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    if (lines.length > 0) lines.push('')
    lines.push(`[${STATS_API_SECTION}]`)
    start = lines.length - 1
  }

  for (const [key, value] of updates) {
    let end = start + 1
    while (end < lines.length && !SECTION_LINE.test(lines[end])) end++

    let found = -1
    for (let i = start + 1; i < end; i++) {
      if (KEY_LINE.exec(lines[i])?.[1].toLowerCase() === key.toLowerCase()) found = i
    }
    if (found !== -1) {
      lines[found] = `${key}=${value}`
    } else {
      // juste après la dernière ligne non vide de la section, pour garder les blancs de séparation
      let at = end
      while (at > start + 1 && lines[at - 1].trim() === '') at--
      lines.splice(at, 0, `${key}=${value}`)
    }
  }

  const result = lines.join(eol)
  return result.endsWith(eol) ? result : result + eol
}
