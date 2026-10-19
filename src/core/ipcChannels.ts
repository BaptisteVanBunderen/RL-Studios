/**
 * Noms des canaux IPC entre le processus principal et le client (React).
 * Fichier SANS import : le preload (bundlé, sans accès aux modules npm) peut l'importer.
 */

/** Client → main : requête/réponse (`ipcRenderer.invoke`). */
export const IPC_INVOKE = {
  getState: 'app:get-state',
  reloadPacks: 'packs:reload',
  setModuleEnabled: 'modules:set-enabled',
  resetSession: 'session:reset'
} as const

/** Main → client : notifications (`webContents.send`). */
export const IPC_EVENTS = {
  connection: 'app:connection',
  session: 'app:session',
  packs: 'app:packs'
} as const
