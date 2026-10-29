/**
 * Noms des canaux IPC entre le processus principal et le client (React).
 * Fichier SANS import : le preload (bundlé, sans accès aux modules npm) peut l'importer.
 */

/** Client → main : requête/réponse (`ipcRenderer.invoke`). */
export const IPC_INVOKE = {
  getState: 'app:get-state',
  reloadPacks: 'packs:reload',
  setModuleEnabled: 'modules:set-enabled',
  resetSession: 'session:reset',
  setPackEnabled: 'packs:set-enabled',
  setModulePlacement: 'modules:set-placement',
  adjustSession: 'session:adjust',
  openOverlaysFolder: 'shell:open-overlays-folder',
  setModuleSetting: 'modules:set-setting',
  getGameSetup: 'game:get-setup',
  detectGame: 'game:detect',
  setGameDir: 'game:set-dir',
  pickGameDir: 'game:pick-dir',
  configureStatsApi: 'game:configure-api',
  restoreStatsApi: 'game:restore-api',
  restartGame: 'game:restart',
  setGameHud: 'game:set-hud',
  setDisplay: 'overlays:set-display',
  setOverlaysVisible: 'overlays:set-visible',
  setShortcut: 'overlays:set-shortcut',
  startEditMode: 'overlays:start-edit',
  stopEditMode: 'overlays:stop-edit',
  setLanguage: 'app:set-language'
} as const

/** Main → client : notifications (`webContents.send`). */
export const IPC_EVENTS = {
  connection: 'app:connection',
  session: 'app:session',
  packs: 'app:packs',
  display: 'app:display',
  overlays: 'app:overlays',
  language: 'app:language'
} as const
