// capture.mjs — Enregistre les trames brutes de la Stats API de Rocket League
//
// Usage :
//   npm i ws
//   node capture.mjs <nom-du-scenario>          (WebSocket, port 49124)
//   node capture.mjs <nom-du-scenario> --tcp    (TCP, port 49123, si le WebSocket ne marche pas)
//
// Écrit captures/<date>_<scenario>.jsonl : une ligne par message reçu,
// avec le texte brut intact (pour vérifier si Data arrive en string JSON).
// Ctrl+C pour arrêter : affiche un résumé des events reçus.

import fs from 'fs'
import net from 'net'
import path from 'path'
import WebSocket from 'ws'

const label = process.argv[2] ?? 'capture'
const useTcp = process.argv.includes('--tcp')
const HOST = '127.0.0.1'
const PORT = useTcp ? 49123 : 49124

fs.mkdirSync('captures', { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const file = path.join('captures', `${stamp}_${label}.jsonl`)
const out = fs.createWriteStream(file, { flags: 'a' })

const t0 = Date.now()
const counts = {}
let total = 0

function record(raw) {
  total++
  let event = '?'
  let dataType = '?'
  try {
    const msg = JSON.parse(raw)
    event = msg.Event ?? '?'
    dataType = typeof msg.Data
  } catch {
    event = 'INVALID_JSON'
  }
  counts[event] = (counts[event] ?? 0) + 1

  // t = ms depuis le début, raw = message exact reçu
  out.write(JSON.stringify({ t: Date.now() - t0, raw }) + '\n')

  // On n'affiche pas UpdateState (trop fréquent), juste les events
  if (event !== 'UpdateState') {
    const s = ((Date.now() - t0) / 1000).toFixed(1).padStart(7)
    console.log(`${s}s  ${event}${dataType === 'string' ? '  (Data en string !)' : ''}`)
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────
function connectWs() {
  const ws = new WebSocket(`ws://${HOST}:${PORT}`)
  ws.on('open', () => console.log(`[capture] Connecté en WebSocket sur ${PORT}`))
  ws.on('message', (data) => record(data.toString('utf8')))
  ws.on('close', () => retry(connectWs))
  ws.on('error', () => {})
}

// ── TCP (secours) : découpage par accolades, en tenant compte des strings ──
function connectTcp() {
  const sock = net.createConnection(PORT, HOST)
  let buf = ''
  sock.on('connect', () => console.log(`[capture] Connecté en TCP sur ${PORT}`))
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8')
    let depth = 0, inStr = false, esc = false, start = -1
    let consumed = 0
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i]
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') inStr = true
      else if (c === '{') { if (depth === 0) start = i; depth++ }
      else if (c === '}') {
        depth--
        if (depth === 0 && start !== -1) {
          record(buf.slice(start, i + 1))
          consumed = i + 1
          start = -1
        }
      }
    }
    buf = buf.slice(consumed)
  })
  sock.on('close', () => retry(connectTcp))
  sock.on('error', () => sock.destroy())
}

let waiting = false
function retry(fn) {
  if (!waiting) console.log('[capture] Jeu non joignable, nouvel essai toutes les 2s...')
  waiting = true
  setTimeout(() => { waiting = false; fn() }, 2000)
}

process.on('SIGINT', () => {
  console.log(`\n[capture] ${total} messages enregistrés dans ${file}`)
  for (const [e, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${e.padEnd(22)} ${n}`)
  }
  out.end(() => process.exit(0))
})

console.log(`[capture] Scénario "${label}" → ${file}`)
useTcp ? connectTcp() : connectWs()
