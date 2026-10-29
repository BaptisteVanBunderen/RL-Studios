import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SHORTCUT,
  type DisplayInfo,
  type DisplayState,
  type OverlaySettings
} from '@core/index'
import { createDemoPack } from '@server/test-utils/fixtures'
import { Services } from './services'

const main: DisplayInfo = {
  id: 10,
  label: 'Principal — 1920 × 1080',
  workArea: { x: 0, y: 0, width: 1920, height: 1040 }
}
const second: DisplayInfo = {
  id: 20,
  label: 'Écran 2 — 2560 × 1440',
  workArea: { x: 1920, y: 0, width: 2560, height: 1440 }
}

describe('Services : écran, interrupteur et raccourci des overlays', () => {
  let base: string
  let displays: DisplayInfo[]
  const started: Services[] = []

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'rl-studio-display-'))
    await createDemoPack(base)
    displays = [main, second]
  })
  afterEach(async () => {
    for (const s of started.splice(0)) await s.stop()
    await rm(base, { recursive: true, force: true })
  })

  async function create(): Promise<Services> {
    const services = new Services({
      configFile: join(base, 'userData', 'config.json'),
      overlaysDir: join(base, 'overlays'),
      sdkSource: '',
      overlayPort: 0,
      gameWebPort: 1,
      getDisplays: () => displays
    })
    started.push(services)
    await services.start()
    return services
  }

  it('écran principal par défaut, liste complète dans l’état', async () => {
    const services = await create()
    const state = services.getState()
    expect(state.display).toEqual(main)
    expect(state.displays).toEqual([main, second])
  })

  it('choisit un écran, le prévient, replace les fenêtres et le retient', async () => {
    const services = await create()
    const seen: DisplayState[] = []
    let packsEvents = 0
    services.onDisplay((d) => seen.push(d))
    services.onPacks(() => packsEvents++)

    const state = await services.setDisplay(20)
    expect(state.display).toEqual(second)
    expect(seen).toHaveLength(1)
    expect(packsEvents).toBe(1) // les fenêtres d'overlay se resynchronisent d'après la nouvelle zone

    const saved = JSON.parse(await readFile(services.config.path, 'utf8')) as { displayId: number }
    expect(saved.displayId).toBe(20)

    expect((await services.setDisplay(null)).display).toEqual(main)
  })

  it('refuse un écran inconnu, et retombe sur le principal si l’écran choisi est débranché', async () => {
    const services = await create()
    await expect(services.setDisplay(999)).rejects.toThrow(/introuvable/)

    await services.setDisplay(20)
    displays = [main]
    expect(services.refreshDisplays().display).toEqual(main)
  })

  it('l’interrupteur et le raccourci sont publiés', async () => {
    const services = await create()
    const seen: OverlaySettings[] = []
    services.onOverlays((o) => seen.push(o))

    expect(services.getState().overlays).toEqual({
      visible: true,
      shortcut: DEFAULT_SHORTCUT,
      shortcutActive: false
    })

    expect(services.toggleOverlays().visible).toBe(false)
    expect(services.setOverlaysVisible(true).visible).toBe(true)

    services.reportShortcutActive(true)
    services.reportShortcutActive(true) // inchangé : pas de nouvelle notification
    expect(seen.map((o) => [o.visible, o.shortcutActive])).toEqual([
      [false, false],
      [true, false],
      [true, true]
    ])
  })

  it('change et supprime le raccourci, refuse un raccourci invalide', async () => {
    const services = await create()
    expect((await services.setShortcut('Ctrl+Alt+O')).shortcut).toBe('Ctrl+Alt+O')
    await expect(services.setShortcut('O')).rejects.toThrow(/invalide/)
    expect((await services.setShortcut(null)).shortcut).toBeNull()

    const saved = JSON.parse(await readFile(services.config.path, 'utf8')) as {
      shortcut: string | null
    }
    expect(saved.shortcut).toBeNull() // « aucun » est un choix, pas un oubli : pas de retour au défaut
  })
})
