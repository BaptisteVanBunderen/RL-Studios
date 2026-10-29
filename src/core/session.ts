import type { MatchResult, MatchStats } from './match'

/** Dernier résultat compté, tel que vu par les overlays. */
export interface LastResult {
  won: boolean
  /** Permet à un overlay de distinguer partie privée (6) / en ligne. */
  playlistId: number | null
}

/**
 * État de session diffusé aux overlays (topic `session`).
 * `streak` est signée : > 0 = victoires d'affilée, < 0 = défaites d'affilée, 0 = aucun résultat.
 * `bestStreak` = meilleure série de victoires. `stats` cumule les statistiques du joueur local :
 * chaque tir, but, passe, arrêt ou démolition de plus s'ajoute dès qu'il se produit (freeplay exclu).
 */
export interface SessionState {
  wins: number
  losses: number
  streak: number
  bestStreak: number
  lastResult: LastResult | null
  stats: SessionStats
}

export type SessionStats = MatchStats

function emptyStats(): SessionStats {
  return { goals: 0, assists: 0, saves: 0, shots: 0, demos: 0, demosTaken: 0 }
}

/**
 * Modes exclus de la session : le freeplay. Liste d'EXCLUSION (et non d'inclusion) pour que les
 * modes jamais observés (extra modes, tournois) comptent par défaut. Les parties privées (6)
 * comptent : elles servent au score des BO. Les replays d'historique sont écartés en amont,
 * par MatchTracker.
 */
export const EXCLUDED_PLAYLIST_IDS: readonly number[] = [9]

export function emptySession(): SessionState {
  return {
    wins: 0,
    losses: 0,
    streak: 0,
    bestStreak: 0,
    lastResult: null,
    stats: emptyStats()
  }
}

/** Compteurs de la session en cours (victoires, défaites, séries). Pure, sans Electron. */
export class SessionStore {
  private session: SessionState = emptySession()
  /** GUID déjà comptés : un même match ne compte jamais deux fois. Survit à `reset()`. */
  private readonly counted = new Set<string>()

  get state(): SessionState {
    return {
      ...this.session,
      lastResult: this.session.lastResult && { ...this.session.lastResult },
      stats: { ...this.session.stats }
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

  /**
   * Ajoute ce que le joueur local vient de faire (variations calculées par MatchTracker).
   * Ignoré hors session (freeplay). Renvoie `true` si les totaux ont changé.
   */
  addStats(delta: SessionStats, playlistId: number | null): boolean {
    if (playlistId !== null && EXCLUDED_PLAYLIST_IDS.includes(playlistId)) return false
    let changed = false
    for (const key of Object.keys(delta) as (keyof SessionStats)[]) {
      if (delta[key] > 0) {
        this.session.stats[key] += delta[key]
        changed = true
      }
    }
    return changed
  }

  /** Remet les compteurs à zéro (nouvelle série, début d'un BO). Les GUID comptés sont conservés. */
  reset(): void {
    this.session = emptySession()
  }

  /**
   * Corrige les compteurs à la main (match non détecté, partie jouée hors de l'application…).
   * Les valeurs fournies remplacent les actuelles ; les autres sont laissées telles quelles.
   * La meilleure série ne baisse jamais et suit une série corrigée à la hausse. Le dernier
   * résultat et les GUID comptés ne changent pas. Renvoie `true` si quelque chose a changé.
   */
  adjust(values: { wins?: number; losses?: number; streak?: number }): boolean {
    const { wins, losses, streak } = values
    if (wins !== undefined && !isCount(wins))
      throw new Error('Victoires : entier de 0 à 9999 attendu')
    if (losses !== undefined && !isCount(losses)) {
      throw new Error('Défaites : entier de 0 à 9999 attendu')
    }
    if (streak !== undefined && !(Number.isInteger(streak) && Math.abs(streak) <= MAX_COUNT)) {
      throw new Error('Série : entier de -9999 à 9999 attendu')
    }

    const before = JSON.stringify(this.session)
    const s = this.session
    if (wins !== undefined) s.wins = wins
    if (losses !== undefined) s.losses = losses
    if (streak !== undefined) {
      s.streak = streak
      s.bestStreak = Math.max(s.bestStreak, streak)
    }
    return JSON.stringify(s) !== before
  }
}

const MAX_COUNT = 9999

function isCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_COUNT
}
