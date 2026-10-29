export interface Envelope {
  event: string
  data: unknown
}

export function parseEnvelope(raw: string): Envelope | null {
  try {
    const message: unknown = JSON.parse(raw)
    if (typeof message !== 'object' || message === null) return null

    const { Event: event, Data: data } = message as Record<string, unknown>
    if (typeof event !== 'string') return null

    return { event, data: typeof data === 'string' ? JSON.parse(data) : data }
  } catch {
    return null
  }
}
