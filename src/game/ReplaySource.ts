import { readFile } from 'node:fs/promises'
import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { parseCaptureText, type RawFrame } from '@core/index'
import type { FrameListener, FrameSource, Unsubscribe } from './FrameSource'

const gunzipAsync = promisify(gunzip)

export interface ReplayOptions {
  speed?: number
}

export class ReplaySource implements FrameSource {
  private readonly frames: readonly RawFrame[]
  private readonly speed: number
  private readonly frameListeners = new Set<FrameListener>()
  private readonly endListeners = new Set<() => void>()

  private running = false
  private nextIndex = 0
  private startedAt = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(frames: readonly RawFrame[], options: ReplayOptions = {}) {
    const speed = options.speed ?? 1
    if (!(speed > 0)) throw new Error(`Facteur de vitesse invalide : ${speed} (doit être > 0)`)
    this.frames = frames
    this.speed = speed
  }

  static async fromFile(path: string, options: ReplayOptions = {}): Promise<ReplaySource> {
    const content = await readFile(path)
    const text = path.endsWith('.gz')
      ? (await gunzipAsync(content)).toString('utf8')
      : content.toString('utf8')
    return new ReplaySource(parseCaptureText(text), options)
  }

  get isRunning(): boolean {
    return this.running
  }

  onFrame(listener: FrameListener): Unsubscribe {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }

  onEnd(listener: () => void): Unsubscribe {
    this.endListeners.add(listener)
    return () => this.endListeners.delete(listener)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.nextIndex = 0
    this.startedAt = performance.now()
    this.pump()
  }

  stop(): void {
    this.running = false
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private pump = (): void => {
    this.timer = null
    const elapsed = performance.now() - this.startedAt

    while (this.running && this.nextIndex < this.frames.length) {
      const frame = this.frames[this.nextIndex]
      const due = frame.t / this.speed
      if (due > elapsed) {
        this.timer = setTimeout(this.pump, due - elapsed)
        return
      }
      this.nextIndex++
      this.emit(frame)
    }

    if (this.running) {
      this.running = false
      for (const listener of this.endListeners) listener()
    }
  }

  private emit(frame: RawFrame): void {
    for (const listener of this.frameListeners) {
      try {
        listener(frame)
      } catch (error) {
        console.error('ReplaySource : erreur dans un abonné de trames', error)
      }
    }
  }
}
