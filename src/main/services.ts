import {
  Emitter,
  MAX_SCALE,
  MIN_SCALE,
  StatsPipeline,
  parseModuleKey,
  positionSchema,
  settingDefaults,
  toPacksSnapshot,
  type AppState,
  type ConnectionStatus,
  type PacksSnapshot,
  type Position,
  type SessionState,
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
