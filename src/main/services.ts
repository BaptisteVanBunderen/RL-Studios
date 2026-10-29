import { mkdir } from 'node:fs/promises'
import {
  Emitter,
  MAX_SCALE,
  MIN_SCALE,
  StatsPipeline,
  deriveConnectionStatus,
  DEFAULT_LANGUAGE,
  isLanguage,
  pick,
  type Language,
  isValidPacketSendRate,
  parseModuleKey,
  positionSchema,
  resolveSettings,
  validateSettingValue,
  toPacksSnapshot,
  type AppState,
  type DisplayInfo,
  type DisplayState,
  type OverlaySettings,
  isValidAccelerator,
  type GameInstall,
  type GameSetupInfo,
  type StatsApiIni,
  type ConnectionStatus,
  type PacksSnapshot,
  type Position,
  type SessionAdjustment,
  type SessionState,
  type SettingValue,
  type Unsubscribe
} from '@core/index'
import {
  GameCloseTimeoutError,
  GameConnection,
  nullGameHost,
  readStatsApiIni,
  restoreStatsApiIni,
  toInstall,
  writeStatsApiIni,
  type GameHost,
  type LinkStatus
} from '@game/index'
import { OverlayServer, type PackSource } from '@server/index'
import { ConfigStore } from './config/ConfigStore'
import { PackLoader } from './packs/PackLoader'

export interface ServicesOptions {
  configFile: string
  /** Packs fournis avec l'application (remplacés à chaque mise à jour). */
  overlaysDir: string
  /**
   * Packs de l'utilisateur, jamais touchés par une mise à jour ; créé au démarrage. Un pack de même
   * nom que l'un des packs fournis le remplace. Sans lui, `overlaysDir` sert aux deux.
   */
  userOverlaysDir?: string
  sdkSource: string
  /**
   * Écrans branchés, l'écran principal en premier (fournis par Electron ; sans eux, un écran
   * 1920 × 1080 fictif, utile aux tests).
   */
  getDisplays?: () => DisplayInfo[]
  overlayPort?: number
  gameWebPort?: number
  /** Langue du système, utilisée tant que l'utilisateur n'en a pas choisi une. */
  systemLanguage?: Language
  /** Processus, installation et lancement du jeu ; sans lui, un hôte inactif (tests). */
  gameHost?: GameHost
}

/** Délai entre deux vérifications de la présence du processus du jeu. */
const PROCESS_POLL_MS = 2000

export function toConnectionStatus(link: LinkStatus): ConnectionStatus {
  return link === 'connected' ? 'connected' : 'game-closed'
}

export class Services {
  readonly config: ConfigStore
  readonly packs: PackLoader
  /** Dossier où l'utilisateur dépose ses packs (celui que le client ouvre). */
  readonly userOverlaysDir: string
  readonly server: OverlayServer
  readonly pipeline: StatsPipeline
  readonly connection: GameConnection
  readonly configRecovered: boolean
  private readonly gamePort: number
  private readonly getDisplays: (() => DisplayInfo[]) | undefined
  private overlaysVisible = true
  private shortcutActive = false
  private language: Language
  private readonly host: GameHost
  private linkConnected = false
  private processRunning = false
  private processTimer: ReturnType<typeof setInterval> | null = null
  private restarting = false
  private frameTimes: number[] = []

  private connectionStatus: ConnectionStatus = 'game-closed'
  private started = false
  private readonly sessionChanges = new Emitter<SessionState>()
  private readonly connectionChanges = new Emitter<ConnectionStatus>()
  private readonly packChanges = new Emitter<PacksSnapshot>()
  private readonly displayChanges = new Emitter<DisplayState>()
  private readonly overlayChanges = new Emitter<OverlaySettings>()
  private readonly languageChanges = new Emitter<Language>()

  constructor(options: ServicesOptions) {
    this.getDisplays = options.getDisplays
    this.host = options.gameHost ?? nullGameHost
    this.config = new ConfigStore(options.configFile)
    this.configRecovered = this.config.load().recovered
    this.language = this.config.config.language ?? options.systemLanguage ?? DEFAULT_LANGUAGE
    this.userOverlaysDir = options.userOverlaysDir ?? options.overlaysDir
    this.packs = new PackLoader(
      options.userOverlaysDir
        ? [options.overlaysDir, options.userOverlaysDir]
        : [options.overlaysDir]
    )

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
    this.connection.onFrame((frame) => {
      this.noteFrame()
      this.pipeline.feed(frame.raw)
    })
    this.connection.onStatus((link) => {
      this.linkConnected = link === 'connected'
      this.refreshStatus()
    })

    this.server.publish('session', this.pipeline.session)
    this.server.publish('match', null)
    this.server.publish('connection', { status: this.connectionStatus })
  }

  async start(): Promise<void> {
    if (this.started) return
    await mkdir(this.userOverlaysDir, { recursive: true })
    await this.packs.scan()
    await this.server.start()
    this.started = true
    await this.refreshProcess()
    this.processTimer = setInterval(() => void this.refreshProcess(), PROCESS_POLL_MS)
    this.processTimer.unref()
    this.connection.start()
  }

  async stop(): Promise<void> {
    if (this.processTimer) clearInterval(this.processTimer)
    this.processTimer = null
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
      ...this.displayState(),
      overlays: this.overlaySettings(),
      language: this.language,
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
    if (!parsed)
      throw new Error(
        this.tr(`Identifiant de module invalide : ${key}`, `Invalid module identifier: ${key}`)
      )

    const exists = this.packs
      .getPack(parsed.packId)
      ?.manifest.modules.some((m) => m.id === parsed.moduleId)
    if (enabled && !exists)
      throw new Error(this.tr(`Module introuvable : ${key}`, `Module not found: ${key}`))

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
    if (!exists) throw new Error(this.tr(`Module introuvable : ${key}`, `Module not found: ${key}`))

    const { position, scale } = placement
    if (position && !positionSchema.safeParse(position).success) {
      throw new Error(
        this.tr(
          'Position invalide (ancre connue, décalages numériques attendus)',
          'Invalid position (known anchor and numeric offsets expected)'
        )
      )
    }
    if (
      typeof scale === 'number' &&
      !(Number.isFinite(scale) && scale >= MIN_SCALE && scale <= MAX_SCALE)
    ) {
      throw new Error(
        this.tr(
          `Échelle invalide : entre ${MIN_SCALE} et ${MAX_SCALE} attendu`,
          `Invalid scale: between ${MIN_SCALE} and ${MAX_SCALE} expected`
        )
      )
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
    if (!module) throw new Error(this.tr(`Module introuvable : ${key}`, `Module not found: ${key}`))

    const def = module.settings.find((s) => s.key === settingKey)
    if (!def)
      throw new Error(
        this.tr(
          `Réglage inconnu : ${key} › ${settingKey}`,
          `Unknown setting: ${key} › ${settingKey}`
        )
      )
    const check = validateSettingValue(def, value, this.language)
    if (!check.ok)
      throw new Error(
        this.tr(
          `Valeur refusée pour « ${def.label} » : ${check.error}`,
          `Value rejected for "${def.label}": ${check.error}`
        )
      )

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
    if (!pack) throw new Error(this.tr(`Pack introuvable : ${packId}`, `Pack not found: ${packId}`))

    const keys = pack.manifest.modules.map((m) => `${packId}/${m.id}`)
    await this.config.update((c) => {
      for (const key of keys) {
        // Désactiver un module qui n'a jamais été activé ne doit rien écrire.
        if (enabled || c.modules[key]) c.modules[key] = { ...c.modules[key], enabled }
      }
    })
    return this.publishPacks()
  }

  // --- langue --------------------------------------------------------------------------------------

  /** Le texte dans la langue de l'interface (messages d'erreur montrés à l'utilisateur). */
  tr(fr: string, en: string): string {
    return pick(this.language, fr, en)
  }

  /** Change la langue de l'interface : enregistrée et annoncée au client. */
  async setLanguage(language: Language): Promise<Language> {
    if (!isLanguage(language)) throw new Error(this.tr('Langue inconnue', 'Unknown language'))
    if (language !== this.language) {
      this.language = language
      await this.config.update((c) => {
        c.language = language
      })
      this.languageChanges.emit(language)
    }
    return language
  }

  onLanguage(listener: (language: Language) => void): Unsubscribe {
    return this.languageChanges.on(listener)
  }

  // --- écran et affichage global des overlays -----------------------------------------------------

  /** Choisit l'écran des overlays (`null` = principal) ; les fenêtres s'y replacent aussitôt. */
  async setDisplay(displayId: number | null): Promise<DisplayState> {
    if (displayId !== null && !this.allDisplays().some((d) => d.id === displayId)) {
      throw new Error(
        this.tr(
          'Écran introuvable : il a peut-être été débranché.',
          'Display not found: it may have been unplugged.'
        )
      )
    }
    await this.config.update((c) => {
      c.displayId = displayId
    })
    return this.refreshDisplays()
  }

  /** À appeler quand les écrans changent (branchement, résolution) : prévient client et fenêtres. */
  refreshDisplays(): DisplayState {
    const state = this.displayState()
    this.displayChanges.emit(state)
    this.publishPacks() // les fenêtres d'overlay se replacent d'après la nouvelle zone
    return state
  }

  setOverlaysVisible(visible: boolean): OverlaySettings {
    this.overlaysVisible = visible
    return this.emitOverlays()
  }

  toggleOverlays(): OverlaySettings {
    return this.setOverlaysVisible(!this.overlaysVisible)
  }

  /** Change le raccourci global (`null` le supprime). Le processus principal l'enregistre. */
  async setShortcut(shortcut: string | null): Promise<OverlaySettings> {
    if (shortcut !== null && !isValidAccelerator(shortcut)) {
      throw new Error(
        this.tr(
          'Raccourci invalide : un modificateur (Ctrl, Alt, Shift) et une touche.',
          'Invalid shortcut: a modifier (Ctrl, Alt, Shift) and a key are required.'
        )
      )
    }
    await this.config.update((c) => {
      c.shortcut = shortcut
    })
    return this.emitOverlays()
  }

  /** Le processus principal dit si le système a accepté le raccourci. */
  reportShortcutActive(active: boolean): void {
    if (active === this.shortcutActive) return
    this.shortcutActive = active
    this.emitOverlays()
  }

  // --- jeu : installation, ini, relance, commandes -------------------------------------------------

  async getGameSetup(): Promise<GameSetupInfo> {
    const candidates = await this.host.detectInstalls()
    const install = await this.chooseInstall(candidates)
    let ini: StatsApiIni = { found: false }
    if (install) ini = await readStatsApiIni(install.dir).catch(() => ({ found: false }) as const)
    return {
      install,
      candidates,
      ini,
      processRunning: this.processRunning,
      packetsPerSecond: this.packetsPerSecond(),
      overlayClients: this.server.clientCount
    }
  }

  /** Relance la recherche automatique (même chose que `getGameSetup`, nommée pour le bouton). */
  detectGame(): Promise<GameSetupInfo> {
    return this.getGameSetup()
  }

  /** Choisit le dossier du jeu à la main ; `null` revient à la détection automatique. */
  async setGameDir(dir: string | null): Promise<GameSetupInfo> {
    if (dir !== null && !(await toInstall(dir))) {
      throw new Error(
        this.tr(
          'Ce dossier ne contient pas Rocket League (sous-dossier TAGame\\Config introuvable). Choisis le dossier qui contient « TAGame » et « Binaries ».',
          'This folder does not contain Rocket League (TAGame\\Config subfolder not found). Choose the folder that contains "TAGame" and "Binaries".'
        )
      )
    }
    await this.config.update((c) => {
      c.gameDir = dir
    })
    return this.getGameSetup()
  }

  /** Active l'API (ou la désactive avec 0) dans l'ini ; le jeu doit ensuite être relancé. */
  async configureStatsApi(packetSendRate: number): Promise<GameSetupInfo> {
    if (!isValidPacketSendRate(packetSendRate)) {
      throw new Error(
        this.tr(
          'Paquets par seconde : entier de 0 à 120 attendu',
          'Packets per second: integer from 0 to 120 expected'
        )
      )
    }
    const install = await this.requireInstall()
    await writeStatsApiIni(install.dir, { packetSendRate }, this.language)
    return this.getGameSetup()
  }

  async restoreStatsApi(): Promise<GameSetupInfo> {
    const install = await this.requireInstall()
    await restoreStatsApiIni(install.dir, this.language)
    return this.getGameSetup()
  }

  /** Ferme le jeu s'il tourne puis le relance par sa boutique (Steam ou Epic). */
  async restartGame(): Promise<void> {
    if (this.restarting)
      throw new Error(this.tr('Une relance est déjà en cours', 'A restart is already in progress'))
    const install = await this.requireInstall()
    if (!install.launcher) {
      throw new Error(
        this.tr(
          'Boutique du jeu inconnue (ni Steam ni Epic) : lance Rocket League toi-même.',
          'Unknown game store (neither Steam nor Epic): launch Rocket League yourself.'
        )
      )
    }
    this.restarting = true
    try {
      try {
        await this.host.closeGame()
      } catch (error) {
        if (!(error instanceof GameCloseTimeoutError)) throw error
        throw new Error(
          this.tr(
            'Le jeu ne se ferme pas : ferme-le toi-même puis réessaie.',
            'The game does not close: close it yourself and try again.'
          )
        )
      }
      await this.refreshProcess()
      await this.host.launch(install.launcher)
    } finally {
      this.restarting = false
    }
  }

  /** Masque ou affiche le HUD natif du jeu (commande `SetHUDVisibility`). */
  setGameHud(visible: boolean): void {
    const sent = this.connection.send({ command: 'SetHUDVisibility', data: { bVisible: visible } })
    if (!sent)
      throw new Error(
        this.tr(
          "Le jeu n'est pas connecté : impossible d'envoyer la commande.",
          'The game is not connected: the command cannot be sent.'
        )
      )
  }

  /** Corrige les compteurs de la session à la main (boutons − / + du client). */
  adjustSession(values: SessionAdjustment): SessionState {
    this.pipeline.adjustSession(values, this.language)
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

  onDisplay(listener: (state: DisplayState) => void): Unsubscribe {
    return this.displayChanges.on(listener)
  }

  onOverlays(listener: (settings: OverlaySettings) => void): Unsubscribe {
    return this.overlayChanges.on(listener)
  }

  private allDisplays(): DisplayInfo[] {
    const displays = this.getDisplays?.() ?? []
    return displays.length > 0
      ? displays
      : [
          {
            id: 0,
            label: 'Principal — 1920 × 1080',
            workArea: { x: 0, y: 0, width: 1920, height: 1080 }
          }
        ]
  }

  /** L'écran choisi s'il est encore branché, sinon le premier (le principal). */
  private displayState(): DisplayState {
    const displays = this.allDisplays()
    const chosen = this.config.config.displayId
    return { display: displays.find((d) => d.id === chosen) ?? displays[0], displays }
  }

  private overlaySettings(): OverlaySettings {
    return {
      visible: this.overlaysVisible,
      shortcut: this.config.config.shortcut,
      shortcutActive: this.shortcutActive
    }
  }

  private emitOverlays(): OverlaySettings {
    const settings = this.overlaySettings()
    this.overlayChanges.emit(settings)
    return settings
  }

  private packsSnapshot(): PacksSnapshot {
    return toPacksSnapshot(this.packs.result, this.config.config)
  }

  private publishPacks(): PacksSnapshot {
    const snapshot = this.packsSnapshot()
    this.packChanges.emit(snapshot)
    return snapshot
  }

  private async chooseInstall(candidates: GameInstall[]): Promise<GameInstall | null> {
    const chosen = this.config.config.gameDir
    if (chosen) {
      const install = await toInstall(chosen)
      if (install) return install
    }
    return candidates[0] ?? null
  }

  private async requireInstall(): Promise<GameInstall> {
    const install = await this.chooseInstall(await this.host.detectInstalls())
    if (!install)
      throw new Error(
        this.tr(
          'Installation de Rocket League introuvable : choisis son dossier.',
          'Rocket League installation not found: choose its folder.'
        )
      )
    return install
  }

  private async refreshProcess(): Promise<void> {
    try {
      this.processRunning = await this.host.isRunning()
    } catch {
      this.processRunning = false
    }
    this.refreshStatus()
  }

  private refreshStatus(): void {
    this.setConnectionStatus(deriveConnectionStatus(this.linkConnected, this.processRunning))
  }

  private noteFrame(): void {
    const now = Date.now()
    this.frameTimes.push(now)
    while (this.frameTimes.length > 0 && this.frameTimes[0] < now - 2000) this.frameTimes.shift()
  }

  /** Trames reçues sur la dernière seconde (0 si le jeu ne parle plus). */
  private packetsPerSecond(): number {
    const since = Date.now() - 1000
    return this.frameTimes.filter((t) => t >= since).length
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
