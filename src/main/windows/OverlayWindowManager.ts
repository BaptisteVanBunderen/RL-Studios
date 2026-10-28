import {
  diffKeys,
  placeInArea,
  scaledSize,
  type ModuleSummary,
  type PacksSnapshot,
  type Rect,
  type Unsubscribe
} from '@core/index'

export interface OverlayWindow {
  load(url: string): void
  setBounds(bounds: Rect): void
  setScale(scale: number): void
  setVisible(visible: boolean): void
  close(): void
  onClosed(listener: () => void): void
  onCrashed(listener: () => void): void
}

export interface WindowHost {
  createOverlayWindow(options: {
    key: string
    bounds: Rect
    scale: number
    visible: boolean
  }): OverlayWindow
  getWorkArea(): Rect
  onWorkAreaChange(listener: () => void): Unsubscribe
}

const MAX_CRASH_RELOADS = 3

interface Open {
  window: OverlayWindow
  bounds: Rect
  scale: number
}

function sameBounds(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

export class OverlayWindowManager {
  private readonly open = new Map<string, Open>()
  private readonly stopWatchingDisplays: Unsubscribe
  private last: PacksSnapshot | null = null
  private visible = true

  constructor(
    private readonly host: WindowHost,
    private readonly baseUrl: () => string
  ) {
    this.stopWatchingDisplays = host.onWorkAreaChange(() => this.resync())
  }

  get openKeys(): string[] {
    return [...this.open.keys()]
  }

  sync(packs: PacksSnapshot): void {
    this.last = packs

    const wanted = new Map<string, ModuleSummary>()
    for (const pack of packs.packs) {
      for (const module of pack.modules) {
        if (module.enabled) wanted.set(module.key, module)
      }
    }

    const { toOpen, toClose } = diffKeys(this.open.keys(), wanted.keys())
    for (const key of toClose) this.close(key)

    const area = this.host.getWorkArea()
    for (const [key, module] of wanted) {
      const bounds = placeInArea(module.position, scaledSize(module.size, module.scale), area)
      if (toOpen.includes(key)) this.openWindow(key, bounds, module.scale)
      else this.update(key, bounds, module.scale)
    }
  }

  resync(): void {
    if (this.last) this.sync(this.last)
  }

  /** Masque ou réaffiche toutes les overlays (raccourci global), sans les fermer. */
  setVisible(visible: boolean): void {
    this.visible = visible
    for (const entry of this.open.values()) entry.window.setVisible(visible)
  }

  closeAll(): void {
    for (const key of this.openKeys) this.close(key)
  }

  dispose(): void {
    this.stopWatchingDisplays()
    this.closeAll()
  }

  private openWindow(key: string, bounds: Rect, scale: number): void {
    const window = this.host.createOverlayWindow({
      key,
      bounds,
      scale,
      visible: this.visible
    })
    const entry: Open = { window, bounds, scale }
    this.open.set(key, entry)

    window.onClosed(() => {
      if (this.open.get(key) === entry) this.open.delete(key)
    })

    const url = `${this.baseUrl()}/overlay/${key}`
    let crashes = 0
    window.onCrashed(() => {
      if (++crashes <= MAX_CRASH_RELOADS) window.load(url)
      else console.error(`Overlay ${key} : la page plante en boucle, elle n'est plus rechargée`)
    })
    window.load(url)
  }

  private update(key: string, bounds: Rect, scale: number): void {
    const entry = this.open.get(key)
    if (!entry) return
    if (!sameBounds(entry.bounds, bounds)) {
      entry.window.setBounds(bounds)
      entry.bounds = bounds
    }
    if (entry.scale !== scale) {
      entry.window.setScale(scale)
      entry.scale = scale
    }
  }

  private close(key: string): void {
    const entry = this.open.get(key)
    if (!entry) return
    this.open.delete(key)
    entry.window.close()
  }
}
