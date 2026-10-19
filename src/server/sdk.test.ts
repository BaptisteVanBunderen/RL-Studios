import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import vm from 'node:vm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { LoadedPack, SessionState } from '@core/index'
import { OverlayServer } from './OverlayServer'
import { createDemoPack, packSource } from './test-utils/fixtures'

const SDK = readFileSync(resolve(process.cwd(), 'src/server/sdk/rlstudio.js'), 'utf8')

interface Sdk {
  version: number
  module: string | null
  on: (topic: string, fn: (payload: unknown) => void) => () => void
  off: (topic: string, fn: (payload: unknown) => void) => void
}

/** Exécute le SDK dans un contexte isolé, comme dans une page : `window`, `location`, `WebSocket`. */
function runSdk(globals: Record<string, unknown>): { sdk: Sdk; window: Record<string, unknown> } {
  const sandbox: Record<string, unknown> = { ...globals }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SDK, sandbox)
  return { sdk: sandbox.RLStudio as Sdk, window: sandbox }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor : délai dépassé')
    await sleep(5)
  }
}

// ---------------------------------------------------------------------------------------------
// Contre le vrai serveur
// ---------------------------------------------------------------------------------------------

describe('SDK contre le vrai serveur', () => {
  let base: string
  let server: OverlayServer
  let packs: Map<string, LoadedPack>
  const cleanups: (() => void)[] = []

  const session = (wins: number): SessionState => ({
    wins,
    losses: 0,
    streak: wins,
    bestStreak: wins,
    lastResult: null
  })

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'rl-studio-sdk-'))
    packs = new Map([['demo', await createDemoPack(base)]])
    server = new OverlayServer({
      port: 0,
      matchIntervalMs: 5,
      packs: packSource(packs),
      sdkSource: SDK
    })
    await server.start()
    server.publish('session', session(4))
    server.publish('match', null)
  })

  afterEach(async () => {
    for (const fn of cleanups.splice(0)) fn()
    await server.stop()
    await rm(base, { recursive: true, force: true })
  })

  /** Charge le SDK comme le ferait la page `/overlay/demo/bar` servie par le serveur. */
  function loadPage(pathname: string): Sdk {
    const { sdk } = runSdk({
      console,
      setTimeout,
      JSON,
      encodeURIComponent,
      decodeURIComponent,
      WebSocket,
      location: {
        protocol: 'http:',
        host: `127.0.0.1:${server.port}`,
        pathname,
        search: ''
      }
    })
    return sdk
  }

  it('est servi par le serveur et s’exécute sans erreur', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/sdk/rlstudio.js`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(SDK)
  })

  it('reconnaît son module d’après l’URL et reçoit réglages + données', async () => {
    const sdk = loadPage('/overlay/demo/bar')
    expect(sdk.module).toBe('demo/bar')

    const settings: unknown[] = []
    const sessions: unknown[] = []
    const matches: unknown[] = []
    sdk.on('settings', (v) => settings.push(v))
    sdk.on('session', (v) => sessions.push(v))
    sdk.on('match', (v) => matches.push(v))

    await waitFor(() => settings.length === 1 && sessions.length === 1)
    expect(settings[0]).toEqual({ color: '#ff0000' })
    expect(sessions[0]).toEqual(session(4))
    expect(matches).toEqual([]) // `match` n'est pas dans le data de ce module

    server.publish('session', session(5))
    await waitFor(() => sessions.length === 2)
    expect(sessions[1]).toEqual(session(5))
  })

  it('reçoit les nouveaux réglages en direct, sans rechargement', async () => {
    const sdk = loadPage('/overlay/demo/bar')
    const settings: unknown[] = []
    sdk.on('settings', (v) => settings.push(v))
    await waitFor(() => settings.length === 1)

    server.publishSettings('demo/bar', { color: '#00ff00' })
    await waitFor(() => settings.length === 2)
    expect(settings[1]).toEqual({ color: '#00ff00' })
  })

  it('un abonné tardif reçoit la dernière valeur connue, pas les events', async () => {
    const sdk = loadPage('/overlay/demo/nohead') // data: match, event
    const first: unknown[] = []
    sdk.on('match', (v) => first.push(v))
    await waitFor(() => first.length === 1)
    server.publish('event', { type: 'matchCreated', matchGuid: 'G' })
    await sleep(40)

    const lateMatch: unknown[] = []
    const lateEvent: unknown[] = []
    sdk.on('match', (v) => lateMatch.push(v))
    sdk.on('event', (v) => lateEvent.push(v))
    expect(lateMatch).toEqual([null]) // tout de suite, sans attendre le réseau
    expect(lateEvent).toEqual([]) // un event ne se rejoue pas
  })

  it('se désabonner coupe l’abonné', async () => {
    const sdk = loadPage('/overlay/demo/bar')
    const got: unknown[] = []
    const off = sdk.on('session', (v) => got.push(v))
    await waitFor(() => got.length === 1)
    off()
    server.publish('session', session(9))
    await sleep(50)
    expect(got).toHaveLength(1)
  })

  it('se reconnecte tout seul quand le serveur redémarre', async () => {
    const port = server.port
    const { sdk } = runSdk({
      console,
      // délais raccourcis pour le test
      setTimeout: (fn: () => void) => setTimeout(fn, 30),
      JSON,
      encodeURIComponent,
      decodeURIComponent,
      WebSocket,
      location: {
        protocol: 'http:',
        host: `127.0.0.1:${port}`,
        pathname: '/overlay/demo/bar',
        search: ''
      }
    })
    const got: SessionState[] = []
    sdk.on('session', (v) => got.push(v as SessionState))
    await waitFor(() => got.length === 1)

    await server.stop()
    await sleep(50)
    server = new OverlayServer({ port, packs: packSource(packs) })
    await server.start()
    server.publish('session', session(7))

    await waitFor(() => got.some((s) => s.wins === 7))
  })
})

// ---------------------------------------------------------------------------------------------
// Cas limites, avec un faux WebSocket et des timers contrôlés
// ---------------------------------------------------------------------------------------------

describe('SDK : cas limites', () => {
  class FakeSocket {
    static instances: FakeSocket[] = []
    onopen: (() => void) | null = null
    onmessage: ((e: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(public url: string) {
      FakeSocket.instances.push(this)
    }
  }

  let timers: { fn: () => void; delay: number }[]
  let errors: unknown[][]

  function load(location: Record<string, unknown>): Sdk {
    FakeSocket.instances = []
    timers = []
    errors = []
    return runSdk({
      console: { error: (...args: unknown[]) => errors.push(args) },
      setTimeout: (fn: () => void, delay: number) => timers.push({ fn, delay }),
      JSON,
      encodeURIComponent,
      decodeURIComponent,
      WebSocket: FakeSocket,
      location: {
        protocol: 'http:',
        host: '127.0.0.1:49200',
        pathname: '/',
        search: '',
        ...location
      }
    }).sdk
  }

  const msg = (type: string, payload: unknown, v = 1): { data: string } => ({
    data: JSON.stringify({ v, type, payload })
  })

  beforeEach(() => {
    FakeSocket.instances = []
  })

  describe('module et URL de connexion', () => {
    it.each([
      ['/overlay/demo/bar', '', 'demo/bar'],
      ['/overlay/demo/bar/', '', 'demo/bar'],
      ['/overlay/mon-pack-2/ma-barre', '', 'mon-pack-2/ma-barre'],
      ['/autre/page', '', null],
      ['/overlay/demo', '', null],
      ['/overlay/demo/modules/bar.html', '', null],
      ['/overlay/DEMO/bar', '', null],
      ['/', '?module=demo/bar', 'demo/bar'],
      ['/test.html', '?x=1&module=demo%2Fbar', 'demo/bar']
    ])('%s%s → module %s', (pathname, search, expected) => {
      const sdk = load({ pathname, search })
      expect(sdk.module).toBe(expected)
    })

    it('se connecte en ws:// avec le module dans l’URL', () => {
      load({ pathname: '/overlay/demo/bar' })
      expect(FakeSocket.instances[0].url).toBe('ws://127.0.0.1:49200/ws?module=demo%2Fbar')
    })

    it('sans module, se connecte sans paramètre', () => {
      load({ pathname: '/' })
      expect(FakeSocket.instances[0].url).toBe('ws://127.0.0.1:49200/ws')
    })

    it('utilise wss:// sur une page https', () => {
      load({ protocol: 'https:', host: 'exemple.test' })
      expect(FakeSocket.instances[0].url).toBe('wss://exemple.test/ws')
    })

    it('ne plante pas sans WebSocket (navigateur très ancien)', () => {
      const { sdk } = runSdk({
        console,
        setTimeout,
        WebSocket: undefined,
        location: { protocol: 'http:', host: 'x', pathname: '/', search: '' }
      })
      expect(sdk.on('session', () => {})).toBeTypeOf('function')
    })
  })

  describe('messages', () => {
    it('distribue chaque message à ses abonnés', () => {
      const sdk = load({})
      const sessions: unknown[] = []
      const events: unknown[] = []
      sdk.on('session', (v) => sessions.push(v))
      sdk.on('event', (v) => events.push(v))
      FakeSocket.instances[0].onmessage?.(msg('session', { wins: 1 }))
      FakeSocket.instances[0].onmessage?.(msg('event', { type: 'goal' }))
      expect(sessions).toEqual([{ wins: 1 }])
      expect(events).toEqual([{ type: 'goal' }])
    })

    it.each([
      ['pas du json', { data: 'pas du json' }],
      ['mauvaise version', msg('session', { wins: 1 }, 2)],
      ['sans type', { data: JSON.stringify({ v: 1, payload: 1 }) }],
      ['type non textuel', { data: JSON.stringify({ v: 1, type: 5, payload: 1 }) }],
      ['null', { data: 'null' }],
      ['tableau', { data: '[]' }]
    ])('ignore un message invalide : %s', (_nom, event) => {
      const sdk = load({})
      const got: unknown[] = []
      sdk.on('session', (v) => got.push(v))
      expect(() => FakeSocket.instances[0].onmessage?.(event)).not.toThrow()
      expect(got).toEqual([])
    })

    it('un abonné qui plante ne prive pas les autres', () => {
      const sdk = load({})
      const got: unknown[] = []
      sdk.on('session', () => {
        throw new Error('boum')
      })
      sdk.on('session', (v) => got.push(v))
      FakeSocket.instances[0].onmessage?.(msg('session', 1))
      expect(got).toEqual([1])
      expect(errors).toHaveLength(1)
    })

    it('un abonné peut se désabonner pendant la distribution', () => {
      const sdk = load({})
      const got: string[] = []
      const off = sdk.on('session', () => {
        got.push('a')
        off()
      })
      sdk.on('session', () => got.push('b'))
      FakeSocket.instances[0].onmessage?.(msg('session', 1))
      FakeSocket.instances[0].onmessage?.(msg('session', 2))
      expect(got).toEqual(['a', 'b', 'b'])
    })

    it('off() retire un abonné précis', () => {
      const sdk = load({})
      const got: unknown[] = []
      const fn = (v: unknown): void => void got.push(v)
      sdk.on('match', fn)
      sdk.off('match', fn)
      sdk.off('match', fn) // sans effet
      sdk.off('inconnu', fn) // sans effet
      FakeSocket.instances[0].onmessage?.(msg('match', 1))
      expect(got).toEqual([])
    })

    it('on() refuse des arguments invalides', () => {
      const sdk = load({})
      // (message plutôt que `instanceof` : l'erreur vient d'un autre contexte `vm`)
      expect(() => sdk.on('session', undefined as never)).toThrow('topic (texte) et fonction')
      expect(() => sdk.on(42 as never, () => {})).toThrow('topic (texte) et fonction')
    })
  })

  describe('mémoire de la dernière valeur', () => {
    it('rejoue aux abonnés tardifs les topics d’état, jamais les events', () => {
      const sdk = load({})
      FakeSocket.instances[0].onmessage?.(msg('session', { wins: 3 }))
      FakeSocket.instances[0].onmessage?.(msg('match', null))
      FakeSocket.instances[0].onmessage?.(msg('event', { type: 'goal' }))

      const got: unknown[] = []
      sdk.on('session', (v) => got.push(['session', v]))
      sdk.on('match', (v) => got.push(['match', v]))
      sdk.on('event', (v) => got.push(['event', v]))
      expect(got).toEqual([
        ['session', { wins: 3 }],
        ['match', null]
      ])
    })

    it('ne garde que la dernière valeur', () => {
      const sdk = load({})
      FakeSocket.instances[0].onmessage?.(msg('session', 1))
      FakeSocket.instances[0].onmessage?.(msg('session', 2))
      const got: unknown[] = []
      sdk.on('session', (v) => got.push(v))
      expect(got).toEqual([2])
    })
  })

  describe('reconnexion', () => {
    it('attend 0,5 s puis double jusqu’à 5 s', () => {
      load({})
      const delays: number[] = []
      for (let i = 0; i < 7; i++) {
        FakeSocket.instances.at(-1)?.onclose?.()
        delays.push(timers.at(-1)!.delay)
        timers.at(-1)!.fn() // le timer expire : nouvelle tentative
      }
      expect(delays).toEqual([500, 1000, 2000, 4000, 5000, 5000, 5000])
      expect(FakeSocket.instances).toHaveLength(8)
    })

    it('une connexion réussie remet le délai à 0,5 s', () => {
      load({})
      FakeSocket.instances.at(-1)?.onclose?.()
      timers.at(-1)!.fn()
      FakeSocket.instances.at(-1)?.onclose?.()
      timers.at(-1)!.fn()
      FakeSocket.instances.at(-1)?.onopen?.() // connecté
      FakeSocket.instances.at(-1)?.onclose?.()
      expect(timers.at(-1)!.delay).toBe(500)
    })

    it('ne programme qu’une reprise même si onclose arrive deux fois', () => {
      load({})
      const socket = FakeSocket.instances[0]
      socket.onclose?.()
      socket.onclose?.()
      expect(timers).toHaveLength(1)
    })

    it('onerror ne plante pas et ne programme rien (onclose s’en charge)', () => {
      load({})
      FakeSocket.instances[0].onerror?.()
      expect(timers).toHaveLength(0)
    })
  })

  it('ne se charge qu’une fois par page', () => {
    const globals = {
      console,
      setTimeout: () => 0,
      JSON,
      encodeURIComponent,
      decodeURIComponent,
      WebSocket: FakeSocket,
      location: { protocol: 'http:', host: 'x', pathname: '/', search: '' }
    }
    FakeSocket.instances = []
    const { window } = runSdk(globals)
    const first = window.RLStudio
    vm.runInContext(SDK, window as vm.Context)
    expect(window.RLStudio).toBe(first)
    expect(FakeSocket.instances).toHaveLength(1)
  })
})
