import { app, BrowserWindow, dialog, screen, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/RL-Studio_logo.png?asset'
import sdkSource from '../server/sdk/rlstudio.js?raw'
import type { DisplayInfo } from '@core/index'
import { registerIpc } from './ipc/register'
import { Services } from './services'
import { createElectronHost } from './windows/electronHost'
import { OverlayWindowManager } from './windows/OverlayWindowManager'

let mainWindow: BrowserWindow | null = null
let services: Services | null = null
let disposeIpc: (() => void) | null = null
let overlayWindows: OverlayWindowManager | null = null
let quitting = false

/** Écran principal : zone utilisable en pixels logiques, et taille réelle pour l'affichage. */
function primaryDisplay(): DisplayInfo {
  const display = screen.getPrimaryDisplay()
  const width = Math.round(display.size.width * display.scaleFactor)
  const height = Math.round(display.size.height * display.scaleFactor)
  return { label: `Principal — ${width} × ${height}`, workArea: display.workArea }
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

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

async function start(): Promise<void> {
  electronApp.setAppUserModelId('com.thevbat.rlstudio')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const created = new Services({
    configFile: join(app.getPath('userData'), 'config.json'),
    overlaysDir: overlaysDir(),
    sdkSource,
    getDisplay: primaryDisplay
  })
  services = created

  try {
    await created.start()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox(
      'RL Studio ne peut pas démarrer',
      `${message}\n\nFermez l'autre application qui utilise ce port, ou changez « overlayPort » dans :\n${created.config.path}`
    )
    quit()
    return
  }

  if (created.configRecovered) {
    void dialog.showMessageBox({
      type: 'warning',
      title: 'RL Studio',
      message: 'Le fichier de configuration était illisible.',
      detail: `Les réglages par défaut sont utilisés. L'ancien fichier est conservé dans :\n${created.config.path}.bak`
    })
  }

  disposeIpc = registerIpc(created, () => mainWindow)

  // Une fenêtre d'overlay par module activé, mise à jour à chaque changement des packs.
  const windows = new OverlayWindowManager(createElectronHost(), () => created.overlayBaseUrl())
  overlayWindows = windows
  windows.sync(created.getState().packs)
  created.onPacks((packs) => windows.sync(packs))

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
