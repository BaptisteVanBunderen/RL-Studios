// test-commands.mjs — Vérifie comment envoyer des commandes au jeu (point ouvert P5).
//
// Questions testées :
//   - Les commandes passent-elles par le WebSocket (49124), par le TCP (49123), ou les deux ?
//   - "Data" doit-il être un objet JSON, ou une string JSON (comme dans les events du jeu) ?
//
// Méthode : le jeu ne répond rien aux commandes. On envoie donc SetMatchPaused, et on regarde
// si le jeu émet l'event MatchPaused en retour → vérification automatique.
// Ensuite on teste SetHUDVisibility, et là c'est toi qui confirmes à l'écran.
//
// À LANCER EN FREEPLAY (ou en partie privée). Le script refuse de tourner en match en ligne.
//
// Usage :
//   npm i ws
//   node test-commands.mjs
//   node test-commands.mjs --force    (désactive la vérification du mode de jeu)

import net from 'net'
import readline from 'readline/promises'
import WebSocket from 'ws'

const HOST = '127.0.0.1'
const WS_PORT = 49124
const TCP_PORT = 49123
const FORCE = process.argv.includes('--force')
const SAFE_PLAYLISTS = [6, 9] // partie privée, freeplay

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
async function ask(q) {
  try { return await rl.question(q) } catch { return '' } // entrée fermée → réponse vide
}

// ── Écoute des events (toujours via WebSocket) ────────────────────────
let lastPlaylist = null
const waiters = []
function waitForEvent(name, timeoutMs) {
  return new Promise((resolve) => {
    const w = { name, resolve }
    waiters.push(w)
    setTimeout(() => {
      const i = waiters.indexOf(w)
      if (i !== -1) { waiters.splice(i, 1); resolve(false) }
    }, timeoutMs)
  })
}

function onMessage(raw) {
  let msg, data
  try {
    msg = JSON.parse(raw)
    data = typeof msg.Data === 'string' ? (msg.Data ? JSON.parse(msg.Data) : {}) : (msg.Data ?? {})
  } catch { return }
  if (msg.Event === 'UpdateState') lastPlaylist = data.Game?.PlaylistId ?? lastPlaylist
  for (const w of [...waiters]) {
    if (w.name === msg.Event) { waiters.splice(waiters.indexOf(w), 1); w.resolve(true) }
  }
}

function openWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${WS_PORT}`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
    ws.on('message', (d) => onMessage(d.toString('utf8')))
  })
}

function openTcp() {
  return new Promise((resolve) => {
    const sock = net.createConnection(TCP_PORT, HOST)
    sock.on('connect', () => resolve(sock))
    sock.on('error', () => resolve(null))
    sock.on('data', () => {}) // on lit et on jette : les events arrivent déjà par le WebSocket
  })
}

// ── Envoi d'une commande selon une variante ───────────────────────────
function encode(command, data, format) {
  return JSON.stringify({ Command: command, Data: format === 'string' ? JSON.stringify(data) : data })
}

function send(transport, conns, command, data, format) {
  const payload = encode(command, data, format)
  if (transport === 'ws') conns.ws.send(payload)
  else conns.tcp.write(payload)
}

// ── Tests ─────────────────────────────────────────────────────────────
async function main() {
  console.log('Test des commandes Stats API — à lancer en freeplay\n')

  let ws
  try { ws = await openWs() } catch {
    console.log(`Impossible de joindre le WebSocket ${WS_PORT}. Le jeu est-il lancé avec WebPort activé ?`)
    process.exit(1)
  }
  const tcp = await openTcp()
  console.log(`WebSocket ${WS_PORT} : connecté`)
  console.log(`TCP ${TCP_PORT}       : ${tcp ? 'connecté' : 'injoignable (Port=0 dans l’ini ?)'}`)

  // Vérification du mode de jeu
  const deadline = Date.now() + 5000
  while (lastPlaylist === null && Date.now() < deadline) await sleep(100)
  if (lastPlaylist === null) {
    console.log('\nAucun UpdateState reçu : lance le freeplay puis relance le script.')
    process.exit(1)
  }
  if (!SAFE_PLAYLISTS.includes(lastPlaylist) && !FORCE) {
    console.log(`\nPlaylistId ${lastPlaylist} : ce n'est ni le freeplay (9) ni une partie privée (6).`)
    console.log('Par sécurité, le script ne met pas en pause un match en ligne. Va en freeplay.')
    process.exit(1)
  }
  console.log(`PlaylistId ${lastPlaylist} : OK\n`)
  await ask('Reste en jeu (pas dans un menu), puis appuie sur Entrée pour commencer... ')

  const conns = { ws, tcp }
  const variants = [
    { transport: 'ws', format: 'object' },
    { transport: 'ws', format: 'string' },
    ...(tcp ? [{ transport: 'tcp', format: 'object' }, { transport: 'tcp', format: 'string' }] : []),
  ]

  // 1. SetMatchPaused : vérifié automatiquement par l'event MatchPaused
  console.log('\n── SetMatchPaused (vérification automatique) ──')
  const results = []
  for (const v of variants) {
    const label = `${v.transport.toUpperCase().padEnd(3)} + Data en ${v.format === 'object' ? 'objet ' : 'string'}`
    const paused = waitForEvent('MatchPaused', 3000)
    send(v.transport, conns, 'SetMatchPaused', { bPaused: true }, v.format)
    const ok = await paused
    let unpausedOk = null
    if (ok) {
      const unpaused = waitForEvent('MatchUnpaused', 3000)
      send(v.transport, conns, 'SetMatchPaused', { bPaused: false }, v.format)
      unpausedOk = await unpaused
    }
    results.push({ ...v, ok, unpausedOk })
    console.log(`  ${label} : ${ok ? 'OK' : 'aucune réaction'}${ok ? (unpausedOk ? ' (reprise OK)' : ' (reprise SANS event)') : ''}`)
    await sleep(1000)
  }

  // Filet de sécurité : on s'assure que le jeu n'est pas resté en pause
  for (const v of variants) send(v.transport, conns, 'SetMatchPaused', { bPaused: false }, v.format)

  // 2. SetHUDVisibility : pas d'event, c'est toi qui confirmes
  console.log('\n── SetHUDVisibility (confirmation à l’écran) ──')
  const toTry = results.some((r) => r.ok) ? results.filter((r) => r.ok) : variants
  const hud = []
  for (const v of toTry) {
    const label = `${v.transport.toUpperCase().padEnd(3)} + Data en ${v.format === 'object' ? 'objet ' : 'string'}`
    send(v.transport, conns, 'SetHUDVisibility', { bVisible: false }, v.format)
    const a = (await ask(`  ${label} : le HUD du jeu a-t-il disparu ? (o/n) `)).trim().toLowerCase()
    send(v.transport, conns, 'SetHUDVisibility', { bVisible: true }, v.format)
    hud.push({ ...v, ok: a.startsWith('o') })
    await sleep(500)
  }
  // Filet de sécurité : on réaffiche le HUD par toutes les variantes
  for (const v of variants) send(v.transport, conns, 'SetHUDVisibility', { bVisible: true }, v.format)

  // 3. Bilan
  console.log('\n── Bilan ──')
  const fmt = (r) => `${r.transport.toUpperCase()} + Data en ${r.format}`
  const pauseOk = results.filter((r) => r.ok).map(fmt)
  const hudOk = hud.filter((r) => r.ok).map(fmt)
  console.log(`  SetMatchPaused   fonctionne avec : ${pauseOk.length ? pauseOk.join(' · ') : 'aucune variante'}`)
  console.log(`  SetHUDVisibility fonctionne avec : ${hudOk.length ? hudOk.join(' · ') : 'aucune variante'}`)
  console.log('\nCopie ce bilan dans la conversation.')

  rl.close()
  ws.close()
  tcp?.destroy()
  setTimeout(() => process.exit(0), 300)
}

main()
