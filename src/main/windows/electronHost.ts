import { BrowserWindow, screen, session } from 'electron'
import type { Rect } from '@core/index'
import type { OverlayWindow, WindowHost } from './OverlayWindowManager'

function createWindow(
  key: string,
  bounds: Rect,
  scale: number,
  startVisible: boolean
): OverlayWindow {
  let visible = startVisible
  let ready = false
  const partition = `overlay:${key}`
  const overlaySession = session.fromPartition(partition)
  overlaySession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  overlaySession.setPermissionCheckHandler(() => false)

  const window = new BrowserWindow({
    ...bounds,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: {
      partition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  window.setAlwaysOnTop(true, 'screen-saver')
  window.setIgnoreMouseEvents(true)
  window.setBounds(bounds)

  const contents = window.webContents
  let origin = ''
  const applyScale = (value: number): void => {
    if (!contents.isDestroyed()) contents.setZoomFactor(value)
  }
  let currentScale = scale
  contents.on('did-finish-load', () => applyScale(currentScale))

  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const guard = (event: { preventDefault: () => void }, url: string): void => {
    if (origin === '' || !url.startsWith(origin)) event.preventDefault()
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
  contents.on('will-attach-webview', (event) => event.preventDefault())

  window.once('ready-to-show', () => {
    ready = true
    if (visible) window.showInactive()
    window.setAlwaysOnTop(true, 'screen-saver')
  })

  return {
    load(url) {
      origin = new URL(url).origin
      window
        .loadURL(url)
        .catch((error) => console.error(`Overlay ${key} : chargement impossible`, error))
    },
    setBounds(next) {
      if (!window.isDestroyed()) window.setBounds(next)
    },
    setScale(next) {
      currentScale = next
      applyScale(next)
    },
    setVisible(next) {
      visible = next
      if (!ready || window.isDestroyed()) return
      if (next) window.showInactive()
      else window.hide()
    },
    close() {
      if (!window.isDestroyed()) window.close()
    },
    onClosed(listener) {
      window.on('closed', listener)
    },
    onCrashed(listener) {
      contents.on('render-process-gone', listener)
    }
  }
}

/** `getWorkArea` : zone de l'écran choisi par l'utilisateur pour les overlays. */
export function createElectronHost(getWorkArea: () => Rect): WindowHost {
  return {
    createOverlayWindow: ({ key, bounds, scale, visible }) =>
      createWindow(key, bounds, scale, visible),
    getWorkArea,
    onWorkAreaChange(listener) {
      // Trois appels explicites : les signatures d'événements d'Electron diffèrent.
      const handler = (): void => listener()
      screen.on('display-metrics-changed', handler)
      screen.on('display-added', handler)
      screen.on('display-removed', handler)
      return () => {
        screen.off('display-metrics-changed', handler)
        screen.off('display-added', handler)
        screen.off('display-removed', handler)
      }
    }
  }
}
