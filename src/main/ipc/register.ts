import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import {
  IPC_EVENTS,
  IPC_INVOKE,
  adjustSessionArgs,
  configureStatsApiArgs,
  setDisplayArgs,
  setLanguageArgs,
  setOverlaysVisibleArgs,
  setShortcutArgs,
  setGameDirArgs,
  setGameHudArgs,
  setModuleEnabledArgs,
  setModulePlacementArgs,
  setModuleSettingArgs,
  setPackEnabledArgs,
  type EventMap,
  type InvokeMap
} from '@core/index'
import type { Services } from '../services'

/** Ce que le branchement IPC demande à l'application Electron (fenêtres, mode édition). */
export interface IpcHost {
  mainWindow(): BrowserWindow | null
  /** Fenêtres autorisées à appeler le main : le client et la couche de placement. */
  clientWindows(): BrowserWindow[]
  startEdit(): void
  stopEdit(): void
}

type Result<K extends keyof InvokeMap> = InvokeMap[K]['result']

/**
 * Branche le client (React) sur les services : requêtes `invoke` du client vers le main, et
 * notifications du main vers le client. Les types viennent de `src/core/ipc.ts`.
 * Renvoie une fonction qui retire tout (arrêt de l'application).
 */
export function registerIpc(services: Services, host: IpcHost): () => void {
  const getWindow = host.mainWindow
  // Seules les fenêtres du client (principale et couche de placement) peuvent appeler : les
  // fenêtres d'overlay n'ont ni preload ni accès IPC.
  const assertFromClient = (event: IpcMainInvokeEvent): void => {
    if (!host.clientWindows().some((w) => !w.isDestroyed() && event.sender === w.webContents)) {
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
    const error = await shell.openPath(services.userOverlaysDir)
    if (error) {
      throw new Error(
        services.tr(
          `Impossible d'ouvrir le dossier des overlays : ${error}`,
          `Cannot open the overlays folder: ${error}`
        )
      )
    }
  })

  const parse = <T>(
    schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
    args: unknown[],
    channel: string
  ): T => {
    const parsed = schema.safeParse(args)
    if (!parsed.success) throw new Error(`Arguments invalides pour ${channel}`)
    return parsed.data as T
  }
  handle(IPC_INVOKE.getGameSetup, () => services.getGameSetup())
  handle(IPC_INVOKE.detectGame, () => services.detectGame())
  handle(IPC_INVOKE.setGameDir, (...args) =>
    services.setGameDir(parse(setGameDirArgs, args, IPC_INVOKE.setGameDir)[0])
  )
  handle(IPC_INVOKE.pickGameDir, async () => {
    const window = getWindow()
    const options = {
      title: 'Choisir le dossier de Rocket League',
      properties: ['openDirectory' as const]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled || !result.filePaths[0] ? null : services.setGameDir(result.filePaths[0])
  })
  handle(IPC_INVOKE.configureStatsApi, (...args) =>
    services.configureStatsApi(parse(configureStatsApiArgs, args, IPC_INVOKE.configureStatsApi)[0])
  )
  handle(IPC_INVOKE.restoreStatsApi, () => services.restoreStatsApi())
  handle(IPC_INVOKE.restartGame, () => services.restartGame())
  handle(IPC_INVOKE.setGameHud, (...args) =>
    services.setGameHud(parse(setGameHudArgs, args, IPC_INVOKE.setGameHud)[0])
  )

  handle(IPC_INVOKE.setDisplay, (...args) =>
    services.setDisplay(parse(setDisplayArgs, args, IPC_INVOKE.setDisplay)[0])
  )
  handle(IPC_INVOKE.setOverlaysVisible, (...args) =>
    services.setOverlaysVisible(
      parse(setOverlaysVisibleArgs, args, IPC_INVOKE.setOverlaysVisible)[0]
    )
  )
  handle(IPC_INVOKE.setShortcut, (...args) =>
    services.setShortcut(parse(setShortcutArgs, args, IPC_INVOKE.setShortcut)[0])
  )
  handle(IPC_INVOKE.startEditMode, () => {
    services.setOverlaysVisible(true) // on place des overlays qu'on voit
    host.startEdit()
  })
  handle(IPC_INVOKE.stopEditMode, () => host.stopEdit())
  handle(IPC_INVOKE.setLanguage, (...args) =>
    services.setLanguage(parse(setLanguageArgs, args, IPC_INVOKE.setLanguage)[0])
  )

  const push = <K extends keyof EventMap>(channel: K, payload: EventMap[K]): void => {
    for (const window of host.clientWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, payload)
    }
  }
  const unsubscribes = [
    services.onConnection((status) => push(IPC_EVENTS.connection, status)),
    services.onSession((session) => push(IPC_EVENTS.session, session)),
    services.onPacks((packs) => push(IPC_EVENTS.packs, packs)),
    services.onDisplay((state) => push(IPC_EVENTS.display, state)),
    services.onOverlays((settings) => push(IPC_EVENTS.overlays, settings)),
    services.onLanguage((language) => push(IPC_EVENTS.language, language))
  ]

  return () => {
    for (const channel of Object.values(IPC_INVOKE)) ipcMain.removeHandler(channel)
    for (const off of unsubscribes) off()
  }
}
