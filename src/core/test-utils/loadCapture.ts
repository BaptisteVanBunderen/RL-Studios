import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { parseCaptureText, type RawFrame } from '../frames'

/** Noms des captures de référence (sans extension), décrites dans docs/stats-api.md. */
export const CAPTURES = [
  '2026-10-01_match-complet',
  '2026-10-01_abandon',
  '2026-10-01_freeplay',
  '2026-10-01_prive-admin',
  '2026-10-01_replay-historique',
  '2026-10-02_session-7-matchs-ff'
] as const

/** Charge une capture de `captures/` (lancé depuis la racine du projet, comme `npm test`). */
export function loadCapture(name: string): RawFrame[] {
  const file = resolve(process.cwd(), 'captures', `${name}.jsonl.gz`)
  return parseCaptureText(gunzipSync(readFileSync(file)).toString('utf8'))
}
