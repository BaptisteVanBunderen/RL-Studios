import { createCrossbarDedupe } from './dedupe'
import { MatchTracker, type TrackerOptions } from './MatchTracker'
import type { MatchState } from './match'
import { normalize } from './normalize'
import { isOverlayEvent, type OverlayEvent } from './protocol'
import type { Language } from './language'
import type { SessionAdjustment } from './ipc'
import { SessionStore, type SessionState } from './session'

export interface PipelineHandlers {
  /** L'état du match a changé (`null` : plus de match). Appelé à chaque trame d'état. */
  onMatch?: (match: MatchState | null) => void
  /** Les compteurs de session ont changé. */
  onSession?: (session: SessionState) => void
  /** Event ponctuel à transmettre aux overlays (jamais pendant un replay d'historique). */
  onEvent?: (event: OverlayEvent) => void
}

/**
 * Chaîne complète « trame brute → overlays » : normalize → dédoublonnage → MatchTracker →
 * SessionStore. Pure et indépendante de la source (jeu ou rejeu) et du serveur : le branchement
 * se fait par les callbacks. Créer UNE chaîne par flux de trames.
 */
export class StatsPipeline {
  readonly tracker: MatchTracker
  readonly store = new SessionStore()
  private readonly dedupe = createCrossbarDedupe()

  constructor(
    private readonly handlers: PipelineHandlers = {},
    trackerOptions: TrackerOptions = {}
  ) {
    this.tracker = new MatchTracker(trackerOptions)
  }

  get match(): MatchState | null {
    return this.tracker.match
  }

  get session(): SessionState {
    return this.store.state
  }

  /** Traite un message brut du jeu (le champ `raw` d'une trame). */
  feed(raw: string): void {
    const parsed = normalize(raw)
    const event = parsed && this.dedupe(parsed)
    if (!event) return

    const { matchChanged, result, statsDelta } = this.tracker.handle(event)

    if (matchChanged) this.handlers.onMatch?.(this.tracker.match)
    // La session avant l'event : un overlay qui réagit à `matchEnded` y lit déjà le nouveau compteur.
    let sessionChanged = result !== null && this.store.add(result)
    if (statsDelta && this.store.addStats(statsDelta.delta, statsDelta.playlistId)) {
      sessionChanged = true
    }
    if (sessionChanged) this.handlers.onSession?.(this.store.state)
    if (isOverlayEvent(event) && !this.tracker.inHistoryReplay) this.handlers.onEvent?.(event)
  }

  /** Corrige les compteurs à la main et prévient les abonnés si quelque chose a changé. */
  adjustSession(values: SessionAdjustment, language?: Language): void {
    if (this.store.adjust(values, language)) this.handlers.onSession?.(this.store.state)
  }

  /** Remet la session à zéro (action du client) et prévient les abonnés. */
  resetSession(): void {
    this.store.reset()
    this.handlers.onSession?.(this.store.state)
  }
}
