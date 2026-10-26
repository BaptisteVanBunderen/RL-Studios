import {
  Emitter,
  MAX_SCALE,
  MIN_SCALE,
  StatsPipeline,
  parseModuleKey,
  positionSchema,
  resolveSettings,
  validateSettingValue,
  toPacksSnapshot,
  type AppState,
  type DisplayInfo,
  type ConnectionStatus,
  type PacksSnapshot,
  type Position,
  type SessionAdjustment,
  type SessionState,
  type SettingValue,
  type Unsubscribe
} from '@core/index'
import { GameConnection, type LinkStatus } from '@game/index'
import { OverlayServer, type PackSource } from '@server/index'
import { ConfigStore } from './config/ConfigStore'
import { PackLoader } from './packs/PackLoader'

export interface ServicesOptions {
  configFile: string
  overlaysDir: string
  sdkSource: string
  /**
   * Écran sur lequel les overlays sont placés (fourni par Electron ; sans lui, un écran
   * 1920 × 1080 fictif, utile aux tests).
   */
  getDisplay?: () => DisplayInfo
  overlayPort?: number
  gameWebPort?: number
}

export function toConnectionStatus(link: LinkStatus): ConnectionStatus {
  return link === 'connected' ? 'connected' : 'game-closed'
}

export class Services {
  readonly config: ConfigStore
  readonly packs: PackLoader
  readonly server: OverlayServer
  readonly pipeline: StatsPipeline
  readonly connection: GameConnection
  readonly configRecovered: boolean
  private readonly gamePort: number
  private readonly getDisplay: (() => DisplayInfo) | undefined

  private connectionStatus: ConnectionStatus = 'game-closed'
  private started = false
  private readonly sessionChanges = new Emitter<SessionState>()
  private readonly connectionChanges = new Emitter<ConnectionStatus>()
  private readonly packChanges = new Emitter<PacksSnapshot>()

  constructor(options: ServicesOptions) {
    this.getDisplay = options.getDisplay
    this.config = new ConfigStore(options.configFile)
    this.configRecovered = this.config.load().recovered
    this.packs = new PackLoader(options.overlaysDir)

    const packSource: PackSource = {
      getPack: (id) => this.packs.getPack(id),
      getSettings: (packId, moduleId) => {
        const module = this.packs.getPack(packId)?.manifest.modules.find((m) => m.id === moduleId)
        return module
          ? resolveSettings(module, this.config.config.modules[`${packId}/${moduleId}`]?.settings)
          : {}
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

    this.gamePort = options.gameWebPort ?? this.config.config.gameWebPort
    this.connection = new GameConnection({ port: this.gamePort })
    this.connection.onFrame((frame) => this.pipeline.feed(frame.raw))
    this.connection.onStatus((link) => this.setConnectionStatus(toConnectionStatus(link)))

    this.server.publish('session', this.pipeline.session)
    this.server.publish('match', null)
    this.server.publish('connection', { status: this.connectionStatus })
  }

  async start(): Promise<void> {
    if (this.started) return
    await this.packs.scan()
    await this.server.start()
    this.started = true
    this.connection.start()
  }

  async stop(): Promise<void> {
    this.connection.stop()
    await this.server.stop()
    await this.config.flush()
    this.started = false
  }

  getState(): AppState {
    return {
      connection: this.connectionStatus,
      session: this.pipeline.session,
      packs: this.packsSnapshot(),
      display: this.display(),
      gamePort: this.gamePort,
      overlayBaseUrl: this.overlayBaseUrl()
    }
  }

  overlayBaseUrl(): string {
    const port = this.server.isRunning ? this.server.port : this.config.config.overlayPort
    return `http://127.0.0.1:${port}`
  }

  async reloadPacks(): Promise<PacksSnapshot> {
    await this.packs.scan()
    return this.publishPacks()
  }

  async setModuleEnabled(key: string, enabled: boolean): Promise<PacksSnapshot> {
    const parsed = parseModuleKey(key)
    if (!parsed) throw new Error(`Identifiant de module invalide : ${key}`)

    const exists = this.packs
      .getPack(parsed.packId)
      ?.manifest.modules.some((m) => m.id === parsed.moduleId)
    if (enabled && !exists) throw new Error(`Module introuvable : ${key}`)

    if (enabled || this.config.config.modules[key]) {
      await this.config.update((c) => {
        c.modules[key] = { ...c.modules[key], enabled }
      })
    }
    return this.publishPacks()
  }

  async setModulePlacement(
    key: string,
    placement: { position?: Position | null; scale?: number | null }
  ): Promise<PacksSnapshot> {
    const parsed = parseModuleKey(key)
    const exists = parsed
      ? this.packs.getPack(parsed.packId)?.manifest.modules.some((m) => m.id === parsed.moduleId)
      : false
    if (!exists) throw new Error(`Module introuvable : ${key}`)

    const { position, scale } = placement
    if (position && !positionSchema.safeParse(position).success) {
      throw new Error('Position invalide (ancre connue, décalages numériques attendus)')
    }
    if (
      typeof scale === 'number' &&
      !(Number.isFinite(scale) && scale >= MIN_SCALE && scale <= MAX_SCALE)
    ) {
      throw new Error(`Échelle invalide : entre ${MIN_SCALE} et ${MAX_SCALE} attendu`)
    }

    await this.config.update((c) => {
      const module = { ...c.modules[key], enabled: c.modules[key]?.enabled ?? false }
      if (position === null) delete module.position
      else if (position) module.position = { anchor: position.anchor, x: position.x, y: position.y }
      if (scale === null) delete module.scale
      else if (typeof scale === 'number') module.scale = scale
      c.modules[key] = module
    })
    return this.publishPacks()
  }

  /**
   * Enregistre la valeur d'un réglage d'un module après l'avoir vérifiée contre le manifeste, puis
   * l'envoie tout de suite aux overlays ouverts de ce module (sans rechargement de leur page).
   */
  async setModuleSetting(
    key: string,
    settingKey: string,
    value: SettingValue
  ): Promise<PacksSnapshot> {
    const parsed = parseModuleKey(key)
    const module = parsed
      ? this.packs.getPack(parsed.packId)?.manifest.modules.find((m) => m.id === parsed.moduleId)
      : undefined
    if (!module) throw new Error(`Module introuvable : ${key}`)

    const def = module.settings.find((s) => s.key === settingKey)
    if (!def) throw new Error(`Réglage inconnu : ${key} › ${settingKey}`)
    const check = validateSettingValue(def, value)
    if (!check.ok) throw new Error(`Valeur refusée pour « ${def.label} » : ${check.error}`)

    await this.config.update((c) => {
      const current = c.modules[key]
      c.modules[key] = {
        ...current,
        enabled: current?.enabled ?? false,
        settings: { ...current?.settings, [settingKey]: check.value }
      }
    })
    this.server.publishSettings(
      key,
      resolveSettings(module, this.config.config.modules[key]?.settings)
    )
    return this.publishPacks()
  }

  /** Active ou désactive TOUS les modules d'un pack en une seule écriture de config. */
  async setPackEnabled(packId: string, enabled: boolean): Promise<PacksSnapshot> {
    const pack = this.packs.getPack(packId)
    if (!pack) throw new Error(`Pack introuvable : ${packId}`)

    const keys = pack.manifest.modules.map((m) => `${packId}/${m.id}`)
    await this.config.update((c) => {
      for (const key of keys) {
        // Désactiver un module qui n'a jamais été activé ne doit rien écrire.
        if (enabled || c.modules[key]) c.modules[key] = { ...c.modules[key], enabled }
      }
    })
    return this.publishPacks()
  }

  /** Corrige les compteurs de la session à la main (boutons − / + du client). */
  adjustSession(values: SessionAdjustment): SessionState {
    this.pipeline.adjustSession(values)
    return this.pipeline.session
  }

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

  onPacks(listener: (packs: PacksSnapshot) => void): Unsubscribe {
    return this.packChanges.on(listener)
  }

  private display(): DisplayInfo {
    return (
      this.getDisplay?.() ?? {
        label: 'Principal — 1920 × 1080',
        workArea: { x: 0, y: 0, width: 1920, height: 1080 }
      }
    )
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

  private rememberLocalPlayer(): void {
    const id = this.pipeline.tracker.localPlayerId
    if (id !== null && id !== this.config.config.localPlayerId) {
      void this.config.update((c) => {
        c.localPlayerId = id
      })
    }
  }
}
