export interface Throttle<T> {
  push(value: T): void
  cancel(): void
}

export function createThrottle<T>(send: (value: T) => void, intervalMs: number): Throttle<T> {
  let lastSentAt = -Infinity
  let pending: { value: T } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (): void => {
    timer = null
    if (!pending) return
    const { value } = pending
    pending = null
    lastSentAt = performance.now()
    send(value)
  }

  return {
    push(value) {
      const wait = lastSentAt + intervalMs - performance.now()
      if (wait <= 0 && timer === null) {
        pending = null
        lastSentAt = performance.now()
        send(value)
        return
      }
      pending = { value }
      if (timer === null) timer = setTimeout(flush, Math.max(0, wait))
    },
    cancel() {
      pending = null
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }
  }
}
