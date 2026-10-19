import {
  Emitter,
  StatsPipeline,
  parseModuleKey,
  settingDefaults,
  toPacksSnapshot,
  type AppState,
  type ConnectionStatus,
  type PacksSnapshot,
  type SessionState,
  type Unsubscribe
} from '@core/index'
import { GameConnection, type LinkStatus } from '@game/index'
import { OverlayServer, type PackSource } from '@server/index'
import { ConfigStore } from './config/ConfigStore'
import { PackLoader } from './packs/PackLoader'

export interface ServicesOptions {
  /** Fichier de config (`<dossier utilisateur>/config.json`). */
  configFile: string
  /** Dossier des packs (`overlays/`). */
  overlaysDir: string
  /** Code du SDK servi à `/sdk/rlstudio.js`. */
  sdkSource: string
  /** Remplacent les ports de la config (tests : `0` = port libre). */
  overlayPort?: number
  gameWebPort?: number
}

/**
 * Tant que la détection du processus du jeu n'existe pas (P5), un lien coupé est publié comme
 * « jeu fermé » ; la distinction avec « API désactivée » viendra avec elle.
 */
export function toConnectionStatus(link: LinkStatus): ConnectionStatus {
  return link === 'connected' ? 'connected' : 'game-closed'
}

/**
 * Les services du processus principal, reliés entre eux :
 *
 *   GameConnection ─ trame brute ─► StatsPipeline ─► OverlayServer ─► overlays (app et OBS)
 *                                         └──────────► client (via les `on…` ci-dessous)
 *
 * Aucune dépendance à Electron : la classe se teste en Node avec un faux jeu. Le fichier
 * `index.ts` ne fait que la lancer, l'arrêter et l'exposer au client.
 */
export class Services {
  readonly config: ConfigStore
  readonly packs: PackLoader
  readonly server: OverlayServer
  readonly pipeline: StatsPipeline
  readonly connection: GameConnection
  /** `true` si le fichier de config existait mais était illisible (valeurs par défaut utilisées). */
  readonly configRecovered: boolean

  private connectionStatus: ConnectionStatus = 'game-closed'
  private started = false
  private readonly sessionChanges = new Emitter<SessionState>()
  private readonly connectionChanges = new Emitter<ConnectionStatus>()
  private readonly packChanges = new Emitter<PacksSnapshot>()

  constructor(options: ServicesOptions) {
    this.config = new ConfigStore(options.configFile)
    this.configRecovered = this.config.load().recovered
    this.packs = new PackLoader(options.overlaysDir)

    const packSource: PackSource = {
      getPack: (id) => this.packs.getPack(id),
      getSettings: (packId, moduleId) => {
        const module = this.packs.getPack(packId)?.manifest.modules.find((m) => m.id === moduleId)
        return module ? settingDefaults(module) : {}
      }
    }
    this.server = new OverlayServer({
      port: options.overlayPort ?? this.config.config.overlayPort,
      packs: packSource,
      sdkSource: options.sdkSource
    })

    this.pipeline = new StatsPipeline(
      {
        onMatch: (match) => {
          this.server.publish('match', match)
          this.rememberLocalPlayer()
        },
        onSession: (session) => {
          this.server.publish('session', session)
          this.sessionChanges.emit(session)
        },
        onEvent: (event) => this.server.publish('event', event)
      },
      { localPlayerId: this.config.config.localPlayerId }
    )

    this.connection = new GameConnection({
      port: options.gameWebPort ?? this.config.config.gameWebPort
    })
    this.connection.onFrame((frame) => this.pipeline.feed(frame.raw))
    this.connection.onStatus((link) => this.setConnectionStatus(toConnectionStatus(link)))

    // Valeurs initiales : un overlay qui se connecte reçoit tout de suite un état cohérent.
    this.server.publish('session', this.pipeline.session)
    this.server.publish('match', null)
    this.server.publish('connection', { status: this.connectionStatus })
  }

  /**
   * Démarre le serveur d'overlays puis la connexion au jeu. Lève une erreur en français si le
   * port est déjà pris ; dans ce cas, rien d'autre n'est démarré.
   */
  async start(): Promise<void> {
    if (this.started) return
    await this.packs.scan()
    await this.server.start()
    this.started = true
    this.connection.start()
  }

  /** Arrêt propre : coupe le jeu, ferme le serveur (et ses clients), termine les écritures. */
  async stop(): Promise<void> {
    this.connection.stop()
    await this.server.stop()
    await this.config.flush()
    this.started = false
  }

  /** Instantané complet pour le client. */
  getState(): AppState {
    return {
      connection: this.connectionStatus,
      session: this.pipeline.session,
      packs: this.packsSnapshot(),
      overlayBaseUrl: this.overlayBaseUrl()
    }
  }

  overlayBaseUrl(): string {
    const port = this.server.isRunning ? this.server.port : this.config.config.overlayPort
    return `http://127.0.0.1:${port}`
  }

  /** Relit le dossier des packs (bouton « actualiser » du client). */
  async reloadPacks(): Promise<PacksSnapshot> {
    await this.packs.scan()
    return this.publishPacks()
  }

  /** Active ou désactive un module (`<pack>/<module>`) et mémorise le choix. */
  async setModuleEnabled(key: string, enabled: boolean): Promise<PacksSnapshot> {
    const parsed = parseModuleKey(key)
    if (!parsed) throw new Error(`Identifiant de module invalide : ${key}`)

    const exists = this.packs
      .getPack(parsed.packId)
      ?.manifest.modules.some((m) => m.id === parsed.moduleId)
    if (enabled && !exists) throw new Error(`Module introuvable : ${key}`)

    // Désactiver un module qui n'a jamais été activé ne doit rien écrire.
    if (enabled || this.config.config.modules[key]) {
      await this.config.update((c) => {
        c.modules[key] = { ...c.modules[key], enabled }
      })
    }
    return this.publishPacks()
  }

  /** Remet la session à zéro (début d'un BO). */
  resetSession(): SessionState {
    this.pipeline.resetSession()
    return this.pipeline.session
  }

  onSession(listener: (session: SessionState) => void): Unsubscribe {
    return this.sessionChanges.on(listener)
  }

  onConnection(listener: (status: ConnectionStatus) => void): Unsubscribe {
    return this.connectionChanges.on(listener)
  }

  /** Les packs ont été rechargés ou un module a été (dés)activé. */
  onPacks(listener: (packs: PacksSnapshot) => void): Unsubscribe {
    return this.packChanges.on(listener)
  }

  private packsSnapshot(): PacksSnapshot {
    return toPacksSnapshot(this.packs.result, this.config.config)
  }

  private publishPacks(): PacksSnapshot {
    const snapshot = this.packsSnapshot()
    this.packChanges.emit(snapshot)
    return snapshot
  }

  private setConnectionStatus(status: ConnectionStatus): void {
    if (status === this.connectionStatus) return
    this.connectionStatus = status
    this.server.publish('connection', { status })
    this.connectionChanges.emit(status)
  }

  /** Le joueur local est appris via `Game.Target` : on le mémorise pour le prochain lancement. */
  private rememberLocalPlayer(): void {
    const id = this.pipeline.tracker.localPlayerId
    if (id !== null && id !== this.config.config.localPlayerId) {
      void this.config.update((c) => {
        c.localPlayerId = id
      })
    }
  }
}
