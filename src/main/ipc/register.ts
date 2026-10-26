import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import {
  IPC_EVENTS,
  IPC_INVOKE,
  adjustSessionArgs,
  setModuleEnabledArgs,
  setModulePlacementArgs,
  setModuleSettingArgs,
  setPackEnabledArgs,
  type EventMap,
  type InvokeMap
} from '@core/index'
import type { Services } from '../services'

type Result<K extends keyof InvokeMap> = InvokeMap[K]['result']

/**
 * Branche le client (React) sur les services : requêtes `invoke` du client vers le main, et
 * notifications du main vers le client. Les types viennent de `src/core/ipc.ts`.
 * Renvoie une fonction qui retire tout (arrêt de l'application).
 */
export function registerIpc(services: Services, getWindow: () => BrowserWindow | null): () => void {
  // Seule la fenêtre du client peut appeler : les fenêtres d'overlay n'ont ni preload ni accès IPC.
  const assertFromClient = (event: IpcMainInvokeEvent): void => {
    const window = getWindow()
    if (!window || event.sender !== window.webContents) {
      throw new Error('Appel IPC refusé : expéditeur inconnu')
    }
  }

  const handle = <K extends keyof InvokeMap>(
    channel: K,
    run: (...args: InvokeMap[K]['args']) => Result<K> | Promise<Result<K>>
  ): void => {
    ipcMain.handle(channel, (event, ...args) => {
      assertFromClient(event)
      return run(...(args as InvokeMap[K]['args']))
    })
  }

  handle(IPC_INVOKE.getState, () => services.getState())
  handle(IPC_INVOKE.reloadPacks, () => services.reloadPacks())
  handle(IPC_INVOKE.resetSession, () => services.resetSession())
  handle(IPC_INVOKE.setModuleEnabled, (...args) => {
    const parsed = setModuleEnabledArgs.safeParse(args)
    if (!parsed.success) throw new Error(`Arguments invalides pour ${IPC_INVOKE.setModuleEnabled}`)
    return services.setModuleEnabled(parsed.data[0], parsed.data[1])
  })

  handle(IPC_INVOKE.setPackEnabled, (...args) => {
    const parsed = setPackEnabledArgs.safeParse(args)
    if (!parsed.success) throw new Error(`Arguments invalides pour ${IPC_INVOKE.setPackEnabled}`)
    return services.setPackEnabled(parsed.data[0], parsed.data[1])
  })
  handle(IPC_INVOKE.setModulePlacement, (...args) => {
    const parsed = setModulePlacementArgs.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Arguments invalides pour ${IPC_INVOKE.setModulePlacement}`)
    }
    return services.setModulePlacement(parsed.data[0], parsed.data[1])
  })
  handle(IPC_INVOKE.adjustSession, (...args) => {
    const parsed = adjustSessionArgs.safeParse(args)
    if (!parsed.success) throw new Error(`Arguments invalides pour ${IPC_INVOKE.adjustSession}`)
    return services.adjustSession(parsed.data[0])
  })
  handle(IPC_INVOKE.setModuleSetting, (...args) => {
    const parsed = setModuleSettingArgs.safeParse(args)
    if (!parsed.success) throw new Error(`Arguments invalides pour ${IPC_INVOKE.setModuleSetting}`)
    return services.setModuleSetting(parsed.data[0], parsed.data[1], parsed.data[2])
  })
  handle(IPC_INVOKE.openOverlaysFolder, async () => {
    // `openPath` renvoie un message d'erreur, ou une chaîne vide si tout va bien.
    const error = await shell.openPath(services.packs.dir)
    if (error) throw new Error(`Impossible d'ouvrir le dossier des overlays : ${error}`)
  })

  const push = <K extends keyof EventMap>(channel: K, payload: EventMap[K]): void => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }
  const unsubscribes = [
    services.onConnection((status) => push(IPC_EVENTS.connection, status)),
    services.onSession((session) => push(IPC_EVENTS.session, session)),
    services.onPacks((packs) => push(IPC_EVENTS.packs, packs))
  ]

  return () => {
    for (const channel of Object.values(IPC_INVOKE)) ipcMain.removeHandler(channel)
    for (const off of unsubscribes) off()
  }
}
