import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_EVENTS, IPC_INVOKE } from '@core/ipcChannels'
import type { RlStudioApi, Unsubscribe } from '@core/index'

// Preload du CLIENT uniquement (les fenêtres d'overlay n'en ont pas). Il n'expose que cette API
// typée, jamais `ipcRenderer` lui-même : le client ne peut appeler que ce qui est listé ici.

function subscribe<T>(channel: string, listener: (payload: T) => void): Unsubscribe {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: RlStudioApi = {
  getState: () => ipcRenderer.invoke(IPC_INVOKE.getState),
  reloadPacks: () => ipcRenderer.invoke(IPC_INVOKE.reloadPacks),
  setModuleEnabled: (moduleKey, enabled) =>
    ipcRenderer.invoke(IPC_INVOKE.setModuleEnabled, moduleKey, enabled),
  resetSession: () => ipcRenderer.invoke(IPC_INVOKE.resetSession),
  setPackEnabled: (packId, enabled) =>
    ipcRenderer.invoke(IPC_INVOKE.setPackEnabled, packId, enabled),
  setModulePlacement: (moduleKey, placement) =>
    ipcRenderer.invoke(IPC_INVOKE.setModulePlacement, moduleKey, placement),
  adjustSession: (values) => ipcRenderer.invoke(IPC_INVOKE.adjustSession, values),
  openOverlaysFolder: () => ipcRenderer.invoke(IPC_INVOKE.openOverlaysFolder),
  setModuleSetting: (moduleKey, settingKey, value) =>
    ipcRenderer.invoke(IPC_INVOKE.setModuleSetting, moduleKey, settingKey, value),
  getGameSetup: () => ipcRenderer.invoke(IPC_INVOKE.getGameSetup),
  detectGame: () => ipcRenderer.invoke(IPC_INVOKE.detectGame),
  setGameDir: (dir) => ipcRenderer.invoke(IPC_INVOKE.setGameDir, dir),
  pickGameDir: () => ipcRenderer.invoke(IPC_INVOKE.pickGameDir),
  configureStatsApi: (rate) => ipcRenderer.invoke(IPC_INVOKE.configureStatsApi, rate),
  restoreStatsApi: () => ipcRenderer.invoke(IPC_INVOKE.restoreStatsApi),
  restartGame: () => ipcRenderer.invoke(IPC_INVOKE.restartGame),
  setGameHud: (visible) => ipcRenderer.invoke(IPC_INVOKE.setGameHud, visible),
  setDisplay: (displayId) => ipcRenderer.invoke(IPC_INVOKE.setDisplay, displayId),
  setOverlaysVisible: (visible) => ipcRenderer.invoke(IPC_INVOKE.setOverlaysVisible, visible),
  setShortcut: (shortcut) => ipcRenderer.invoke(IPC_INVOKE.setShortcut, shortcut),
  startEditMode: () => ipcRenderer.invoke(IPC_INVOKE.startEditMode),
  stopEditMode: () => ipcRenderer.invoke(IPC_INVOKE.stopEditMode),
  onDisplay: (listener) => subscribe(IPC_EVENTS.display, listener),
  onOverlays: (listener) => subscribe(IPC_EVENTS.overlays, listener),
  setLanguage: (language) => ipcRenderer.invoke(IPC_INVOKE.setLanguage, language),
  onLanguage: (listener) => subscribe(IPC_EVENTS.language, listener),
  onConnection: (listener) => subscribe(IPC_EVENTS.connection, listener),
  onSession: (listener) => subscribe(IPC_EVENTS.session, listener),
  onPacks: (listener) => subscribe(IPC_EVENTS.packs, listener)
}

contextBridge.exposeInMainWorld('rlstudio', api)
