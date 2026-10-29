import type { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

/** Charge le client React ; `hash` choisit la page (`edit` = couche de placement à la souris). */
export function loadClientPage(window: BrowserWindow, hash?: string): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'] + (hash ? `#${hash}` : ''))
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}
