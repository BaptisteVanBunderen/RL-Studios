import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModuleSummary, PacksSnapshot, Rect } from '@core/index'
import { OverlayWindowManager, type OverlayWindow, type WindowHost } from './OverlayWindowManager'

// ---------------------------------------------------------------------------------------------
// Faux hôte : enregistre ce que le gestionnaire demande, comme le ferait Electron
// ---------------------------------------------------------------------------------------------

class FakeWindow implements OverlayWindow {
  log: string[] = []
  loaded: string[] = []
  bounds: Rect
  scale: number
  closed = false
  private closedListeners: (() => void)[] = []
  private crashListeners: (() => void)[] = []

  constructor(
    readonly key: string,
    bounds: Rect,
    scale: number
  ) {
    this.bounds = bounds
    this.scale = scale
  }
  load(url: string): void {
    this.loaded.push(url)
  }
  setBounds(bounds: Rect): void {
    this.bounds = bounds
    this.log.push('setBounds')
  }
  setScale(scale: number): void {
    this.scale = scale
    this.log.push('setScale')
  }
  close(): void {
    this.closed = true
    this.closedListeners.forEach((l) => l()) // Electron émet « closed » à la fermeture
  }
  onClosed(listener: () => void): void {
    this.closedListeners.push(listener)
  }
  onCrashed(listener: () => void): void {
    this.crashListeners.push(listener)
  }
  /** Simule une fermeture par le système (pas demandée par le gestionnaire). */
  closeBySystem(): void {
    this.closed = true
    this.closedListeners.forEach((l) => l())
  }
  crash(): void {
    this.crashListeners.forEach((l) => l())
  }
}

class FakeHost implements WindowHost {
  windows: FakeWindow[] = []
  area: Rect = { x: 0, y: 0, width: 1920, height: 1080 }
  private listeners = new Set<() => void>()

  createOverlayWindow(options: { key: string; bounds: Rect; scale: number }): FakeWindow {
    const window = new FakeWindow(options.key, options.bounds, options.scale)
    this.windows.push(window)
    return window
  }
  getWorkArea(): Rect {
    return this.area
  }
  onWorkAreaChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  displayChanged(area: Rect): void {
    this.area = area
    this.listeners.forEach((l) => l())
  }
  get listenerCount(): number {
    return this.listeners.size
  }
  /** La fenêtre vivante d'un module, ou `undefined`. */
  alive(key: string): FakeWindow | undefined {
    return this.windows.find((w) => w.key === key && !w.closed)
  }
}

function module(key: string, over: Partial<ModuleSummary> = {}): ModuleSummary {
  const [, id] = key.split('/')
  return {
    key,
    id,
    name: id,
    description: '',
    enabled: true,
    size: { width: 400, height: 50 },
    position: { anchor: 'top-left', x: 0, y: 0 },
    defaultPosition: { anchor: 'top-left', x: 0, y: 0 },
    scale: 1,
    data: [],
    settings: [],
    ...over
  }
}

function snapshot(...modules: ModuleSummary[]): PacksSnapshot {
  const byPack = new Map<string, ModuleSummary[]>()
  for (const m of modules) {
    const pack = m.key.split('/')[0]
    byPack.set(pack, [...(byPack.get(pack) ?? []), m])
  }
  return {
    packs: [...byPack].map(([id, mods]) => ({
      id,
      name: id,
      description: '',
      author: '',
      version: '1.0.0',
      preview: null,
      warnings: [],
      modules: mods
    })),
    invalid: []
  }
}

describe('OverlayWindowManager', () => {
  let host: FakeHost
  let manager: OverlayWindowManager

  function create(base = 'http://127.0.0.1:49200'): void {
    host = new FakeHost()
    manager = new OverlayWindowManager(host, () => base)
  }
  afterEach(() => vi.restoreAllMocks())

  describe('ouverture et fermeture', () => {
    it('n’ouvre rien tant qu’aucun module n’est activé', () => {
      create()
      manager.sync(snapshot(module('p/a', { enabled: false })))
      expect(host.windows).toEqual([])
      expect(manager.openKeys).toEqual([])
    })

    it('ouvre une fenêtre par module activé, sur l’URL du module', () => {
      create('http://127.0.0.1:50000')
      manager.sync(snapshot(module('p/a'), module('p/b', { enabled: false }), module('q/c')))
      expect(manager.openKeys).toEqual(['p/a', 'q/c'])
      expect(host.alive('p/a')?.loaded).toEqual(['http://127.0.0.1:50000/overlay/p/a'])
      expect(host.alive('q/c')?.loaded).toEqual(['http://127.0.0.1:50000/overlay/q/c'])
    })

    it('ferme la fenêtre d’un module désactivé, garde les autres', () => {
      create()
      manager.sync(snapshot(module('p/a'), module('p/b')))
      manager.sync(snapshot(module('p/a'), module('p/b', { enabled: false })))
      expect(host.alive('p/a')).toBeDefined()
      expect(host.alive('p/b')).toBeUndefined()
      expect(manager.openKeys).toEqual(['p/a'])
    })

    it('ferme la fenêtre d’un module disparu des packs', () => {
      create()
      manager.sync(snapshot(module('p/a'), module('p/b')))
      manager.sync(snapshot(module('p/a')))
      expect(manager.openKeys).toEqual(['p/a'])
    })

    it('rouvre un module réactivé (nouvelle fenêtre)', () => {
      create()
      manager.sync(snapshot(module('p/a')))
      manager.sync(snapshot(module('p/a', { enabled: false })))
      manager.sync(snapshot(module('p/a')))
      expect(host.windows).toHaveLength(2)
      expect(host.alive('p/a')).toBe(host.windows[1])
    })

    it('un sync identique ne rouvre ni ne déplace rien', () => {
      create()
      const state = snapshot(module('p/a'))
      manager.sync(state)
      manager.sync(state)
      manager.sync(state)
      expect(host.windows).toHaveLength(1)
      expect(host.windows[0].log).toEqual([])
      expect(host.windows[0].loaded).toHaveLength(1)
    })

    it('closeAll ferme tout', () => {
      create()
      manager.sync(snapshot(module('p/a'), module('p/b')))
      manager.closeAll()
      expect(manager.openKeys).toEqual([])
      expect(host.windows.every((w) => w.closed)).toBe(true)
    })
  })

  describe('placement', () => {
    it('place la fenêtre d’après l’ancre, dans la zone de travail', () => {
      create()
      manager.sync(snapshot(module('p/a', { position: { anchor: 'top-right', x: 20, y: 30 } })))
      expect(host.alive('p/a')?.bounds).toEqual({ x: 1500, y: 30, width: 400, height: 50 })
    })

    it('utilise la zone de travail de l’hôte (barre des tâches, second écran…)', () => {
      create()
      host.area = { x: 1920, y: 0, width: 2560, height: 1400 }
      manager.sync(snapshot(module('p/a', { position: { anchor: 'bottom-left', x: 10, y: 10 } })))
      expect(host.alive('p/a')?.bounds).toEqual({ x: 1930, y: 1340, width: 400, height: 50 })
    })

    it('applique l’échelle à la taille de la fenêtre ET au contenu', () => {
      create()
      manager.sync(snapshot(module('p/a', { scale: 1.5 })))
      expect(host.alive('p/a')?.bounds).toMatchObject({ width: 600, height: 75 })
      expect(host.alive('p/a')?.scale).toBe(1.5)
    })

    it('déplace une fenêtre ouverte quand sa position change', () => {
      create()
      manager.sync(snapshot(module('p/a')))
      manager.sync(snapshot(module('p/a', { position: { anchor: 'top-left', x: 100, y: 200 } })))
      const w = host.alive('p/a')!
      expect(w.bounds).toMatchObject({ x: 100, y: 200 })
      expect(w.log).toEqual(['setBounds'])
      expect(host.windows).toHaveLength(1) // même fenêtre, pas de réouverture
    })

    it('change l’échelle d’une fenêtre ouverte : taille et zoom', () => {
      create()
      manager.sync(snapshot(module('p/a')))
      manager.sync(snapshot(module('p/a', { scale: 2 })))
      const w = host.alive('p/a')!
      expect(w.bounds).toMatchObject({ width: 800, height: 100 })
      expect(w.scale).toBe(2)
      expect(w.log).toEqual(['setBounds', 'setScale'])
    })

    it('la taille du manifeste qui change redimensionne la fenêtre', () => {
      create()
      manager.sync(snapshot(module('p/a')))
      manager.sync(snapshot(module('p/a', { size: { width: 500, height: 60 } })))
      expect(host.alive('p/a')?.bounds).toMatchObject({ width: 500, height: 60 })
    })

    it('un écran devenu plus petit rapatrie les overlays (sans nouvel état des packs)', () => {
      create()
      manager.sync(snapshot(module('p/a', { position: { anchor: 'top-right', x: 20, y: 20 } })))
      expect(host.alive('p/a')?.bounds.x).toBe(1500) // 1920 - 400 - 20

      host.displayChanged({ x: 0, y: 0, width: 800, height: 600 })
      expect(host.alive('p/a')?.bounds).toMatchObject({ x: 380, y: 20 })
    })

    it('un changement d’écran sans rien d’ouvert est sans effet', () => {
      create()
      expect(() => host.displayChanged({ x: 0, y: 0, width: 800, height: 600 })).not.toThrow()
      expect(host.windows).toEqual([])
    })
  })

  describe('robustesse', () => {
    it('une fenêtre fermée par le système est oubliée, et rouverte au prochain resync', () => {
      create()
      manager.sync(snapshot(module('p/a')))
      host.alive('p/a')!.closeBySystem()
      expect(manager.openKeys).toEqual([])

      manager.resync()
      expect(manager.openKeys).toEqual(['p/a'])
      expect(host.windows).toHaveLength(2)
    })

    it('fermer une fenêtre soi-même ne la « rouvre » pas à cause de l’événement closed', () => {
      create()
      manager.sync(snapshot(module('p/a')))
      manager.sync(snapshot(module('p/a', { enabled: false })))
      manager.resync()
      expect(host.windows).toHaveLength(1)
      expect(manager.openKeys).toEqual([])
    })

    it('recharge une page dont le rendu a planté', () => {
      create()
      manager.sync(snapshot(module('p/a')))
      const w = host.alive('p/a')!
      w.crash()
      expect(w.loaded).toHaveLength(2)
      expect(w.loaded[1]).toBe(w.loaded[0])
    })

    it('arrête de recharger une page qui plante en boucle', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      create()
      manager.sync(snapshot(module('p/a')))
      const w = host.alive('p/a')!
      for (let i = 0; i < 10; i++) w.crash()
      expect(w.loaded).toHaveLength(1 + 3)
      expect(console.error).toHaveBeenCalled()
    })

    it('lit l’URL de base à l’ouverture (le port peut ne pas être connu plus tôt)', () => {
      host = new FakeHost()
      let base = 'http://127.0.0.1:1111'
      manager = new OverlayWindowManager(host, () => base)
      manager.sync(snapshot(module('p/a')))
      base = 'http://127.0.0.1:2222'
      manager.sync(snapshot(module('p/a'), module('p/b')))
      expect(host.alive('p/a')?.loaded[0]).toBe('http://127.0.0.1:1111/overlay/p/a')
      expect(host.alive('p/b')?.loaded[0]).toBe('http://127.0.0.1:2222/overlay/p/b')
    })

    it('resync sans état connu ne fait rien', () => {
      create()
      expect(() => manager.resync()).not.toThrow()
    })

    it('dispose ferme tout et arrête de surveiller les écrans', () => {
      create()
      manager.sync(snapshot(module('p/a')))
      expect(host.listenerCount).toBe(1)
      manager.dispose()
      expect(host.listenerCount).toBe(0)
      expect(manager.openKeys).toEqual([])
      expect(host.windows[0].closed).toBe(true)
    })
  })
})
