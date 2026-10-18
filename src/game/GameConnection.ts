import type { RawFrame } from '@core/index'
import WebSocket from 'ws'
import type { FrameListener, FrameSource, Unsubscribe } from './FrameSource'

export const GAME_WEB_PORT = 49124

export type LinkStatus = 'connected' | 'disconnected'

export interface GameConnectionOptions {
  port?: number
  initialRetryDelayMs?: number
  maxRetryDelayMs?: number
  handshakeTimeoutMs?: number
}

export class GameConnection implements FrameSource {
  private readonly port: number
  private readonly initialDelay: number
  private readonly maxDelay: number
  private readonly handshakeTimeout: number

  private readonly frameListeners = new Set<FrameListener>()
  private readonly statusListeners = new Set<(status: LinkStatus) => void>()

  private running = false
  private socket: WebSocket | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay: number
  private startedAt = 0
  private currentStatus: LinkStatus = 'disconnected'

  constructor(options: GameConnectionOptions = {}) {
    this.port = options.port ?? GAME_WEB_PORT
    this.initialDelay = options.initialRetryDelayMs ?? 1000
    this.maxDelay = options.maxRetryDelayMs ?? 5000
    this.handshakeTimeout = options.handshakeTimeoutMs ?? 3000
    this.retryDelay = this.initialDelay
  }

  get status(): LinkStatus {
    return this.currentStatus
  }

  get isRunning(): boolean {
    return this.running
  }

  onFrame(listener: FrameListener): Unsubscribe {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }

  onStatus(listener: (status: LinkStatus) => void): Unsubscribe {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.startedAt = performance.now()
    this.retryDelay = this.initialDelay
    this.connect()
  }

  stop(): void {
    this.running = false
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.removeAllListeners()
      socket.on('error', () => {})
      socket.terminate()
    }
    this.setStatus('disconnected')
  }

  private connect(): void {
    if (!this.running) return

    const socket = new WebSocket(`ws://127.0.0.1:${this.port}`, {
      handshakeTimeout: this.handshakeTimeout
    })
    this.socket = socket

    socket.on('open', () => {
      this.retryDelay = this.initialDelay
      this.setStatus('connected')
    })

    socket.on('message', (data, isBinary) => {
      if (isBinary) return
      this.emitFrame({ t: performance.now() - this.startedAt, raw: data.toString('utf8') })
    })

    socket.on('error', () => {})

    socket.on('close', () => {
      if (this.socket !== socket) return
      this.socket = null
      this.setStatus('disconnected')
      this.scheduleRetry()
    })
  }

  private scheduleRetry(): void {
    if (!this.running || this.retryTimer !== null) return
    const delay = this.retryDelay
    this.retryDelay = Math.min(this.retryDelay * 2, this.maxDelay)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, delay)
  }

  private setStatus(status: LinkStatus): void {
    if (status === this.currentStatus) return
    this.currentStatus = status
    for (const listener of this.statusListeners) {
      try {
        listener(status)
      } catch (error) {
        console.error('GameConnection : erreur dans un abonné au statut', error)
      }
    }
  }

  private emitFrame(frame: RawFrame): void {
    for (const listener of this.frameListeners) {
      try {
        listener(frame)
      } catch (error) {
        console.error('GameConnection : erreur dans un abonné de trames', error)
      }
    }
  }
}
