import type { RawFrame } from '@core/index'

export type FrameListener = (frame: RawFrame) => void
export type Unsubscribe = () => void

export interface FrameSource {
  onFrame(listener: FrameListener): Unsubscribe
  start(): void
  stop(): void
}
