import { app, BrowserWindow, dialog, globalShortcut, screen, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/RL-Studio_logo.png?asset'
import sdkSource from '../server/sdk/rlstudio.js?raw'
import { detectLanguage, type DisplayInfo } from '@core/index'
import { createGameHost } from '@game/index'
import { registerIpc } from './ipc/register'
import { Services } from './services'
import { createElectronHost } from './windows/electronHost'
import { OverlayWindowManager } from './windows/OverlayWindowManager'
import { createEditWindow } from './windows/editWindow'
import { loadClientPage } from './windows/clientPage'

let mainWindow: BrowserWindow | null = null
let services: Services | null = null
let disposeIpc: (() => void) | null = null
let overlayWindows: OverlayWindowManager | null = null
let editWindow: BrowserWindow | null = null
let quitting = false

/** Écrans branchés, l'écran principal en premier : zone utilisable (pixels logiques) et taille réelle. */
function allDisplays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay()
  const others = screen.getAllDisplays().filter((d) => d.id !== primary.id)
  return [primary, ...others].map((display, index) => {
    const width = Math.round(display.size.width * display.scaleFactor)
    const height = Math.round(display.size.height * display.scaleFactor)
    const name = index === 0 ? 'Principal' : `Écran ${index + 1}`
    return { id: display.id, label: `${name} — ${width} × ${height}`, workArea: display.workArea }
  })
}

function overlaysDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'overlays')
    : join(app.getAppPath(), 'overlays')
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    title: 'RL Studio',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })

  window.on('ready-to-show', () => window.show())
  window.on('closed', () => {
    mainWindow = null
    quit()
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const ownPages =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? process.env['ELECTRON_RENDERER_URL']
      : 'file://'
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ownPages)) event.preventDefault()
  })

  loadClientPage(window)
  return window
}

function startEdit(): void {
  if (editWindow && !editWindow.isDestroyed()) {
    editWindow.focus()
    return
  }
  if (!services) return
  const window = createEditWindow(services.getState().display.workArea, icon)
  editWindow = window
  window.on('closed', () => {
    if (editWindow === window) editWindow = null
  })
}

function stopEdit(): void {
  if (editWindow && !editWindow.isDestroyed()) editWindow.close()
}

/**
 * Raccourci global d'affichage des overlays. Le système peut le refuser (déjà pris par une autre
 * application) : l'état est renvoyé au client, qui l'affiche.
 */
function bindShortcut(created: Services): void {
  let registered: string | null | undefined
  const apply = (): void => {
    const wanted = created.getState().overlays.shortcut
    if (wanted === registered) return
    globalShortcut.unregisterAll()
    registered = wanted
    let ok = false
    if (wanted) {
      try {
        ok = globalShortcut.register(wanted, () => created.toggleOverlays())
      } catch {
        ok = false
      }
    }
    created.reportShortcutActive(ok)
  }
  apply()
  created.onOverlays(apply)
}

async function start(): Promise<void> {
  electronApp.setAppUserModelId('com.thevbat.rlstudio')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const created = new Services({
    configFile: join(app.getPath('userData'), 'config.json'),
    overlaysDir: overlaysDir(),
    sdkSource,
    getDisplays: allDisplays,
    systemLanguage: detectLanguage(app.getLocale()),
    gameHost: createGameHost({ openExternal: (url) => shell.openExternal(url) })
  })
  services = created

  try {
    await created.start()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox(
      created.tr('RL Studio ne peut pas démarrer', 'RL Studio cannot start'),
      created.tr(
        `${message}\n\nFermez l'autre application qui utilise ce port, ou changez « overlayPort » dans :\n${created.config.path}`,
        `${message}\n\nClose the other application using this port, or change "overlayPort" in:\n${created.config.path}`
      )
    )
    quit()
    return
  }

  if (created.configRecovered) {
    void dialog.showMessageBox({
      type: 'warning',
      title: 'RL Studio',
      message: created.tr(
        'Le fichier de configuration était illisible.',
        'The configuration file was unreadable.'
      ),
      detail: created.tr(
        `Les réglages par défaut sont utilisés. L'ancien fichier est conservé dans :\n${created.config.path}.bak`,
        `Default settings are used. The old file is kept in:\n${created.config.path}.bak`
      )
    })
  }

  disposeIpc = registerIpc(created, {
    mainWindow: () => mainWindow,
    clientWindows: () =>
      [mainWindow, editWindow].filter((w): w is BrowserWindow => w !== null && !w.isDestroyed()),
    startEdit,
    stopEdit
  })

  // Une fenêtre d'overlay par module activé, mise à jour à chaque changement des packs.
  const windows = new OverlayWindowManager(
    createElectronHost(() => created.getState().display.workArea),
    () => created.overlayBaseUrl()
  )
  overlayWindows = windows
  windows.sync(created.getState().packs)
  created.onPacks((packs) => windows.sync(packs))
  created.onOverlays((settings) => windows.setVisible(settings.visible))
  const refreshDisplays = (): void => void created.refreshDisplays()
  screen.on('display-added', refreshDisplays)
  screen.on('display-removed', refreshDisplays)
  screen.on('display-metrics-changed', refreshDisplays)
  bindShortcut(created)

  mainWindow = createWindow()
}

function quit(): void {
  app.quit()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(start, (error) => {
    console.error('RL Studio : démarrage impossible', error)
    app.exit(1)
  })

  app.on('will-quit', () => globalShortcut.unregisterAll())

  app.on('before-quit', (event) => {
    if (quitting || !services) return
    event.preventDefault()
    quitting = true
    disposeIpc?.()
    overlayWindows?.dispose()
    services
      .stop()
      .catch((error) => console.error("RL Studio : erreur à l'arrêt des services", error))
      .finally(() => app.quit())
  })
}
