import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { Rect } from '@core/index'
import { loadClientPage } from './clientPage'

/**
 * Couche de placement à la souris : une fenêtre transparente qui couvre la zone de travail de
 * l'écran des overlays. Elle affiche notre propre page (le client, route `#edit`) avec le même
 * preload : les overlays, eux, restent transparents à la souris et sans accès au système.
 */
export function createEditWindow(area: Rect, icon: string): BrowserWindow {
  const window = new BrowserWindow({
    ...area,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'RL Studio — placement des overlays',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setBounds(area)

  window.once('ready-to-show', () => {
    window.show()
    window.focus()
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

  loadClientPage(window, 'edit')
  return window
}
