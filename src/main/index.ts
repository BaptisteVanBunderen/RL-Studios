import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/RL-Studio_logo.png?asset'
import sdkSource from '../server/sdk/rlstudio.js?raw'
import { registerIpc } from './ipc/register'
import { Services } from './services'

let mainWindow: BrowserWindow | null = null
let services: Services | null = null
let disposeIpc: (() => void) | null = null
let quitting = false

/** Dossier des packs : à la racine du projet en développement, dans les ressources une fois installé. */
function overlaysDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'overlays')
    : join(app.getAppPath(), 'overlays')
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    title: 'RL Studio',
    icon,
    webPreferences: {
      // Le client n'a accès au processus principal que par l'API typée du preload.
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })

  window.on('ready-to-show', () => window.show())
  window.on('closed', () => {
    mainWindow = null
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Le client ne navigue jamais ailleurs que sur ses propres pages.
  const ownPages =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? process.env['ELECTRON_RENDERER_URL']
      : 'file://'
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ownPages)) event.preventDefault()
  })

  // HMR en développement ; fichier local une fois installé.
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
    sdkSource
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
  mainWindow = createWindow()
}

/** Quitte l'application ; `before-quit` arrête d'abord les services. */
function quit(): void {
  app.quit()
}

// Une seule instance : deux RL Studio se disputeraient le port du serveur d'overlays.
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

  // Arrêt propre : on suspend la fermeture le temps de couper la connexion au jeu, fermer le
  // serveur d'overlays (et ses clients) et terminer l'écriture de la config.
  app.on('before-quit', (event) => {
    if (quitting || !services) return
    event.preventDefault()
    quitting = true
    disposeIpc?.()
    services
      .stop()
      .catch((error) => console.error("RL Studio : erreur à l'arrêt des services", error))
      .finally(() => app.quit())
  })

  // Fermer la fenêtre du client quitte l'application (les overlays en dépendent).
  app.on('window-all-closed', () => quit())
}
