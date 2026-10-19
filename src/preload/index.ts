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
  onConnection: (listener) => subscribe(IPC_EVENTS.connection, listener),
  onSession: (listener) => subscribe(IPC_EVENTS.session, listener),
  onPacks: (listener) => subscribe(IPC_EVENTS.packs, listener)
}

contextBridge.exposeInMainWorld('rlstudio', api)
