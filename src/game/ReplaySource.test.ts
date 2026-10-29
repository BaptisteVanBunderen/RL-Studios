import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalize, type RawFrame } from '@core/index'
import { loadCapture } from '@core/test-utils/loadCapture'
import { ReplaySource } from './ReplaySource'

const frames: RawFrame[] = [
  { t: 0, raw: 'a' },
  { t: 100, raw: 'b' },
  { t: 100, raw: 'c' },
  { t: 1000, raw: 'd' }
]

function collect(source: ReplaySource): { got: string[]; ended: () => number } {
  const got: string[] = []
  let ends = 0
  source.onFrame((f) => got.push(f.raw))
  source.onEnd(() => ends++)
  return { got, ended: () => ends }
}

describe('ReplaySource : respect du temps (horloge simulée)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('vitesse 1 : émet chaque trame à son heure `t`', () => {
    const source = new ReplaySource(frames)
    const { got, ended } = collect(source)

    source.start()
    expect(got).toEqual(['a']) // t = 0 : tout de suite

    vi.advanceTimersByTime(99)
    expect(got).toEqual(['a'])
    vi.advanceTimersByTime(1)
    expect(got).toEqual(['a', 'b', 'c']) // deux trames au même t partent ensemble

    vi.advanceTimersByTime(899)
    expect(got).toHaveLength(3)
    expect(ended()).toBe(0)
    vi.advanceTimersByTime(1)
    expect(got).toEqual(['a', 'b', 'c', 'd'])
    expect(ended()).toBe(1)
    expect(source.isRunning).toBe(false)
  })

  it('vitesse 2 : deux fois plus vite', () => {
    const source = new ReplaySource(frames, { speed: 2 })
    const { got } = collect(source)
    source.start()
    vi.advanceTimersByTime(50)
    expect(got).toEqual(['a', 'b', 'c'])
    vi.advanceTimersByTime(450)
    expect(got).toEqual(['a', 'b', 'c', 'd'])
  })

  it('vitesse Infinity : tout est émis immédiatement, dans l’ordre', () => {
    const source = new ReplaySource(frames, { speed: Infinity })
    const { got, ended } = collect(source)
    source.start()
    expect(got).toEqual(['a', 'b', 'c', 'd'])
    expect(ended()).toBe(1)
  })

  it('stop() interrompt le rejeu sans événement de fin', () => {
    const source = new ReplaySource(frames)
    const { got, ended } = collect(source)
    source.start()
    vi.advanceTimersByTime(100)
    source.stop()
    vi.advanceTimersByTime(5000)
    expect(got).toEqual(['a', 'b', 'c'])
    expect(ended()).toBe(0)
  })

  it('stop() appelé depuis un abonné arrête aussi la boucle en cours', () => {
    const source = new ReplaySource(frames, { speed: Infinity })
    const got: string[] = []
    source.onFrame((f) => {
      got.push(f.raw)
      if (f.raw === 'b') source.stop()
    })
    source.start()
    expect(got).toEqual(['a', 'b'])
  })

  it('start() relance depuis le début ; un second start() en cours est sans effet', () => {
    const source = new ReplaySource(frames)
    const { got } = collect(source)
    source.start()
    source.start() // rejeu en cours : sans effet (pas de trame 'a' en double)
    expect(got).toEqual(['a'])

    vi.advanceTimersByTime(1000)
    expect(got).toHaveLength(4)
    expect(source.isRunning).toBe(false)

    source.start() // rejeu terminé : on repart du début
    expect(got).toHaveLength(5)
    expect(got[4]).toBe('a')
  })

  it('se désabonner coupe l’abonné', () => {
    const source = new ReplaySource(frames, { speed: Infinity })
    const got: string[] = []
    const off = source.onFrame((f) => got.push(f.raw))
    off()
    source.start()
    expect(got).toEqual([])
  })

  it('un abonné qui plante ne bloque ni le rejeu ni les autres abonnés', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const source = new ReplaySource(frames, { speed: Infinity })
    source.onFrame(() => {
      throw new Error('boum')
    })
    const { got } = collect(source)
    source.start()
    expect(got).toHaveLength(4)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('refuse un facteur de vitesse invalide', () => {
    expect(() => new ReplaySource(frames, { speed: 0 })).toThrow('vitesse')
    expect(() => new ReplaySource(frames, { speed: -1 })).toThrow('vitesse')
    expect(() => new ReplaySource(frames, { speed: NaN })).toThrow('vitesse')
  })
})

describe('ReplaySource.fromFile', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rl-studio-replay-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const text = '{"t":0,"raw":"x"}\n{"t":10,"raw":"y"}\n'

  /** Charge un fichier, le rejoue sans attente et renvoie les trames reçues. */
  async function play(path: string): Promise<string[]> {
    const source = await ReplaySource.fromFile(path, { speed: Infinity })
    const { got } = collect(source)
    source.start()
    return got
  }

  it('lit un .jsonl', async () => {
    const path = join(dir, 'c.jsonl')
    await writeFile(path, text)
    expect(await play(path)).toEqual(['x', 'y'])
  })

  it('lit un .jsonl.gz', async () => {
    const path = join(dir, 'c.jsonl.gz')
    await writeFile(path, gzipSync(text))
    expect(await play(path)).toEqual(['x', 'y'])
  })

  it('refuse un fichier qui n’est pas une capture (ex. .matches.jsonl)', async () => {
    const path = join(dir, 'resume.matches.jsonl')
    await writeFile(path, '{"match":1}\n')
    await expect(ReplaySource.fromFile(path)).rejects.toThrow('ligne 1')
  })
})

describe('ReplaySource sur une vraie capture', () => {
  it('rejoue toutes les trames du fichier, dans l’ordre, jusqu’à normalize()', async () => {
    const name = '2026-10-01_freeplay'
    const source = await ReplaySource.fromFile(`captures/${name}.jsonl.gz`, { speed: Infinity })
    const received: RawFrame[] = []
    source.onFrame((f) => received.push(f))
    let ended = false
    source.onEnd(() => (ended = true))

    source.start()

    expect(ended).toBe(true)
    expect(received).toEqual(loadCapture(name))
    const updates = received.map((f) => normalize(f.raw)).filter((e) => e?.type === 'update')
    expect(updates.length).toBeGreaterThan(0)
  })
})
