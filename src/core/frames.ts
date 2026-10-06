import { z } from 'zod'

export interface RawFrame {
  t: number
  raw: string
}

const frameSchema = z.looseObject({ t: z.number().nonnegative(), raw: z.string() })

export function parseCaptureText(text: string): RawFrame[] {
  const frames: RawFrame[] = []
  const lines = text.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') continue

    let json: unknown
    try {
      json = JSON.parse(line)
    } catch {
      throw new Error(`Capture invalide : JSON illisible à la ligne ${i + 1}`)
    }

    const result = frameSchema.safeParse(json)
    if (!result.success) {
      throw new Error(`Capture invalide : la ligne ${i + 1} n'est pas une trame { t, raw }`)
    }
    frames.push({ t: result.data.t, raw: result.data.raw })
  }

  return frames
}
