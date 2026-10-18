import type { MatchResult } from './match'

/** Dernier résultat compté, tel que vu par les overlays. */
export interface LastResult {
  won: boolean
  /** Permet à un overlay de distinguer partie privée (6) / en ligne. */
  playlistId: number | null
}

/**
 * État de session diffusé aux overlays (topic `session`).
 * `streak` est signée : > 0 = victoires d'affilée, < 0 = défaites d'affilée, 0 = aucun résultat.
 * `bestStreak` = meilleure série de victoires.
 */
export interface SessionState {
  wins: number
  losses: number
  streak: number
  bestStreak: number
  lastResult: LastResult | null
}

/**
 * Modes exclus de la session : le freeplay. Liste d'EXCLUSION (et non d'inclusion) pour que les
 * modes jamais observés (extra modes, tournois) comptent par défaut. Les parties privées (6)
 * comptent : elles servent au score des BO. Les replays d'historique sont écartés en amont,
 * par MatchTracker.
 */
export const EXCLUDED_PLAYLIST_IDS: readonly number[] = [9]

export function emptySession(): SessionState {
  return { wins: 0, losses: 0, streak: 0, bestStreak: 0, lastResult: null }
}

/** Compteurs de la session en cours (victoires, défaites, séries). Pure, sans Electron. */
export class SessionStore {
  private session: SessionState = emptySession()
  /** GUID déjà comptés : un même match ne compte jamais deux fois. Survit à `reset()`. */
  private readonly counted = new Set<string>()

  get state(): SessionState {
    return {
      ...this.session,
      lastResult: this.session.lastResult && { ...this.session.lastResult }
    }
  }

  /**
   * Ajoute un résultat si le mode compte et si le match n'a pas déjà été compté.
   * Renvoie `true` si la session a changé.
   */
  add(result: MatchResult): boolean {
    if (result.playlistId !== null && EXCLUDED_PLAYLIST_IDS.includes(result.playlistId))
      return false

    // Un GUID vide ne peut pas servir de clé de dédoublonnage : on compte alors sans le mémoriser.
    if (result.matchGuid !== '') {
      if (this.counted.has(result.matchGuid)) return false
      this.counted.add(result.matchGuid)
    }

    const s = this.session
    if (result.won) {
      s.wins++
      s.streak = s.streak > 0 ? s.streak + 1 : 1
      s.bestStreak = Math.max(s.bestStreak, s.streak)
    } else {
      s.losses++
      s.streak = s.streak < 0 ? s.streak - 1 : -1
    }
    s.lastResult = { won: result.won, playlistId: result.playlistId }
    return true
  }

  /** Remet les compteurs à zéro (nouvelle série, début d'un BO). Les GUID comptés sont conservés. */
  reset(): void {
    this.session = emptySession()
  }
}
