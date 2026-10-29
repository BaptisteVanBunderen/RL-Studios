// observe.mjs — À laisser tourner pendant que tu joues normalement.
//
// Couvre deux points ouverts de la P0 :
//   1. Valider la règle de résultat (ff adverse, abandon, leave pendant le replay)
//   2. Relever les PlaylistId de chaque mode (classé, 1v1, 3v3, extra modes...)
//
// Usage :
//   npm i ws
//   node observe.mjs            (enregistrement allégé, ~1 UpdateState/s)
//   node observe.mjs --full     (enregistre toutes les trames, attention à la taille)
//
// Produit, dans captures/ :
//   <date>_observe.jsonl  trames (même format que capture.mjs, rejouable)
//   matches.jsonl         un résumé par match (cumulé entre les lancements)
//   playlists.json        les PlaylistId vus, avec arènes et formats (cumulé)
//
// Après chaque match, le terminal affiche ce que la règle de résultat a conclu.
// Si ça ne correspond pas à ce qui s'est passé en vrai, note-le : c'est ça qu'on cherche.

import fs from 'fs'
import path from 'path'
import WebSocket from 'ws'

const PORT = 49124
const FULL = process.argv.includes('--full')
const DIR = 'captures'
const MIN_MATCH_SEC = Number(process.env.RL_MIN_MATCH_SEC ?? 10) // en dessous : match fantôme ignoré
fs.mkdirSync(DIR, { recursive: true })

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const framesFile = path.join(DIR, `${stamp}_observe.jsonl`)
const matchesFile = path.join(DIR, 'matches.jsonl')
const playlistsFile = path.join(DIR, 'playlists.json')
const frames = fs.createWriteStream(framesFile, { flags: 'a' })

// IDs connus de la communauté, À CONFIRMER : c'est justement le but du script
const HINTS = {
  1: 'Duel (non classé ?)', 2: 'Doubles (non classé)', 3: 'Standard (non classé ?)', 4: 'Chaos ?',
  6: 'Partie privée', 8: 'Exhibition hors ligne ?', 9: 'Freeplay / entraînement',
  10: 'Duel classé ?', 11: 'Doubles classé ?', 13: 'Standard classé ?',
}

const t0 = Date.now()
const now = () => Date.now() - t0
const sec = (ms) => (ms / 1000).toFixed(1) + 's'

// ── Enregistrement allégé ─────────────────────────────────────────────
let lastKeptUpdate = -Infinity
let lastSignature = ''
function keepFrame(raw, event, data) {
  if (FULL || event !== 'UpdateState') return true
  const g = data.Game ?? {}
  // On garde toujours une trame quand quelque chose d'important change
  const sig = JSON.stringify([
    g.bHasWinner, g.bReplay, g.bOvertime, g.PlaylistId, g.Target?.TeamNum,
    (g.Teams ?? []).map((t) => t.Score), (data.Players ?? []).length,
  ])
  if (sig !== lastSignature) { lastSignature = sig; lastKeptUpdate = now(); return true }
  if (now() - lastKeptUpdate >= 1000) { lastKeptUpdate = now(); return true }
  return false
}

// ── Suivi d'un match ──────────────────────────────────────────────────
let match = null

function newMatch(guid) {
  return {
    startedAt: now(), guid: guid || '', playlistId: null, arena: null,
    me: null, myTeam: null, teamSizes: [0, 0], scores: [0, 0],
    timeLeft: null, overtime: false,
    winnerKnownAt: null, winnerTeamFromState: null, winStatfeed: [],
    matchEnded: null, podium: false,
    inGoalReplay: false, leftDuringReplay: false,
    opponentsLeftEarly: [], lastPlayers: new Map(),
    fromHistoryReplay: false,
  }
}

function onUpdateState(d) {
  const g = d.Game ?? {}
  if (!match) match = newMatch(d.MatchGuid)
  if (d.MatchGuid && !match.guid) match.guid = d.MatchGuid
  if ('Frame' in g) { match.fromHistoryReplay = true }
  match.playlistId = g.PlaylistId ?? match.playlistId
  match.arena = g.Arena ?? match.arena
  match.timeLeft = g.TimeSeconds
  match.overtime = !!g.bOvertime
  match.inGoalReplay = !!g.bReplay
  match.scores = (g.Teams ?? []).map((t) => t.Score)

  const players = d.Players ?? []
  const sizes = [0, 0]
  for (const p of players) {
    if (p.TeamNum === 0 || p.TeamNum === 1) sizes[p.TeamNum]++
    match.lastPlayers.set(p.Name, p)
  }
  match.teamSizes = [Math.max(match.teamSizes[0], sizes[0]), Math.max(match.teamSizes[1], sizes[1])]

  // Joueur local = Target, hors replay (de but ou d'historique)
  if (!g.bReplay && !('Frame' in g) && g.bHasTarget && g.Target?.Name) {
    const t = g.Target
    if (t.TeamNum === 0 || t.TeamNum === 1) {
      const p = players.find((x) => x.Name === t.Name)
      match.me = { name: t.Name, primaryId: p?.PrimaryId ?? match.me?.primaryId ?? '?' }
      match.myTeam = t.TeamNum
    }
  }

  if (g.bHasWinner && match.winnerKnownAt === null) {
    match.winnerKnownAt = now()
    const w = (g.Teams ?? []).find((t) => t.Name === g.Winner)
    match.winnerTeamFromState = w ? w.TeamNum : null
    log(`  bHasWinner=true (Winner="${g.Winner}", temps restant ${g.TimeSeconds}s)`)
  }
}

function onEvent(event, d) {
  switch (event) {
    case 'ReplayCreated':
      log(`Replay d'historique chargé (${d.FileName}) → ignoré pour la session`)
      break
    case 'MatchCreated':
      // Des trames peuvent précéder MatchCreated de quelques dixièmes de seconde :
      // on garde le match en cours s'il vient juste de commencer, sinon on repart de zéro
      if (!match || now() - match.startedAt > 5000) match = newMatch(d.MatchGuid)
      break
    case 'StatfeedEvent':
      if (match && d.EventName === 'Win') {
        match.winStatfeed.push({ name: d.MainTarget?.Name, team: d.MainTarget?.TeamNum })
        if (match.winnerKnownAt === null) match.winnerKnownAt = now()
      }
      break
    case 'MatchEnded':
      if (match) match.matchEnded = { winnerTeamNum: d.WinnerTeamNum, at: now() }
      break
    case 'PodiumStart':
      if (match) match.podium = true
      break
    case 'PlayerLeft':
      if (match && match.me && d.PlayerName !== match.me.name && !match.destroyedAt) {
        const p = match.lastPlayers.get(d.PlayerName)
        if (p && p.TeamNum !== match.myTeam) match.opponentsLeftEarly.push(d.PlayerName)
      }
      break
    case 'MatchDestroyed':
      if (match) {
        match.destroyedAt = now()
        match.leftDuringReplay = match.inGoalReplay
        finishMatch()
      }
      break
  }
}

// ── Règle de résultat proposée (architecture-et-manifeste.md) ─────────
function applyRule(m) {
  if (m.myTeam === null) return { result: 'inconnu', why: 'joueur local jamais identifié' }
  if (m.matchEnded) {
    return { result: m.matchEnded.winnerTeamNum === m.myTeam ? 'VICTOIRE' : 'DÉFAITE', why: 'MatchEnded reçu' }
  }
  if (m.winnerKnownAt !== null) {
    let team = m.winnerTeamFromState
    if (team === null && m.winStatfeed.length) team = m.winStatfeed[0].team
    if (team === 0 || team === 1) {
      return { result: team === m.myTeam ? 'VICTOIRE' : 'DÉFAITE', why: 'vainqueur connu avant le leave' }
    }
  }
  return { result: 'DÉFAITE', why: 'abandon (aucun vainqueur connu)' }
}

function endKind(m) {
  if (m.fromHistoryReplay) return 'replay d’historique'
  if (m.matchEnded && m.timeLeft > 0 && !m.overtime) return 'fin anticipée (ff probable)'
  if (m.matchEnded) return 'match terminé'
  if (m.winnerKnownAt !== null) return 'vainqueur connu puis leave'
  if (m.opponentsLeftEarly.length) return 'leave après départ d’adversaires'
  return 'abandon'
}

function finishMatch() {
  const m = match
  match = null
  if (!m) return
  const duration = (m.destroyedAt - m.startedAt) / 1000
  const format = `${m.teamSizes[0]}v${m.teamSizes[1]}`

  // Freeplay et matchs fantômes très courts : on note la playlist et c'est tout
  recordPlaylist(m, format)
  if (m.playlistId === 9 || duration < MIN_MATCH_SEC) {
    log(`(PlaylistId ${m.playlistId}, ${m.arena}, ${duration.toFixed(0)}s — ignoré)`)
    return
  }

  const verdict = m.fromHistoryReplay ? { result: 'ignoré', why: 'replay d’historique' } : applyRule(m)
  const kind = endKind(m)
  const summary = {
    date: new Date().toISOString(), guid: m.guid, playlistId: m.playlistId,
    playlistHint: HINTS[m.playlistId] ?? null, arena: m.arena, format,
    me: m.me, myTeam: m.myTeam, scores: m.scores, timeLeft: m.timeLeft, overtime: m.overtime,
    matchEnded: m.matchEnded?.winnerTeamNum ?? null,
    winnerKnownBeforeLeave: m.winnerKnownAt !== null && !m.matchEnded,
    winStatfeed: m.winStatfeed, podium: m.podium, leftDuringReplay: m.leftDuringReplay,
    opponentsLeftEarly: m.opponentsLeftEarly, endKind: kind,
    ruleResult: verdict.result, ruleWhy: verdict.why, durationSec: Math.round(duration),
    framesFile,
  }
  fs.appendFileSync(matchesFile, JSON.stringify(summary) + '\n')

  const myScore = m.myTeam === null ? '?' : m.scores[m.myTeam]
  const theirScore = m.myTeam === null ? '?' : m.scores[1 - m.myTeam]
  console.log('')
  console.log('┌──────────────────────────────────────────────────────────────')
  console.log(`│ Match ${format} · PlaylistId ${m.playlistId} (${HINTS[m.playlistId] ?? 'inconnu'}) · ${m.arena}`)
  console.log(`│ Toi : ${m.me?.name ?? '?'} (équipe ${m.myTeam ?? '?'}) · score ${myScore}-${theirScore} · ${m.timeLeft}s restantes${m.overtime ? ' (prolongation)' : ''}`)
  console.log(`│ Fin : ${kind}`)
  console.log(`│   MatchEnded : ${m.matchEnded ? 'oui (vainqueur ' + m.matchEnded.winnerTeamNum + ')' : 'non'}`
    + ` · vainqueur connu avant : ${m.winnerKnownAt !== null ? 'oui' : 'non'}`
    + (m.matchEnded ? '' : ` · leave pendant un replay : ${m.leftDuringReplay ? 'oui' : 'non'}`))
  if (m.opponentsLeftEarly.length) console.log(`│   Adversaires partis avant toi : ${m.opponentsLeftEarly.join(', ')}`)
  console.log(`│ ► Règle : ${verdict.result} (${verdict.why})`)
  console.log('│   Si ce n’est pas le vrai résultat, note l’heure : ' + new Date().toLocaleTimeString('fr-FR'))
  console.log('└──────────────────────────────────────────────────────────────')
}

function recordPlaylist(m, format) {
  if (m.playlistId === null || m.playlistId === undefined) return
  let all = {}
  try { all = JSON.parse(fs.readFileSync(playlistsFile, 'utf8')) } catch {}
  const k = String(m.playlistId)
  const e = all[k] ?? { hint: HINTS[m.playlistId] ?? null, label: '', count: 0, formats: [], arenas: [] }
  e.count++
  if (!e.formats.includes(format)) e.formats.push(format)
  if (m.arena && !e.arenas.includes(m.arena)) e.arenas.push(m.arena)
  all[k] = e
  fs.writeFileSync(playlistsFile, JSON.stringify(all, null, 2))
}

// ── Connexion ─────────────────────────────────────────────────────────
function log(msg) { console.log(`${sec(now()).padStart(8)}  ${msg}`) }

function handle(raw) {
  let msg, data
  try {
    msg = JSON.parse(raw)
    data = typeof msg.Data === 'string' ? (msg.Data ? JSON.parse(msg.Data) : {}) : (msg.Data ?? {})
  } catch { return }
  const event = msg.Event
  if (keepFrame(raw, event, data)) frames.write(JSON.stringify({ t: now(), raw }) + '\n')
  if (event === 'UpdateState') onUpdateState(data)
  else onEvent(event, data)
}

let waiting = false
function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
  ws.on('open', () => { waiting = false; log(`Connecté au jeu (WebSocket ${PORT}). Joue normalement, Ctrl+C pour arrêter.`) })
  ws.on('message', (d) => handle(d.toString('utf8')))
  ws.on('close', () => {
    if (match) { log('Connexion perdue pendant un match (jeu fermé ?)'); match = null }
    if (!waiting) log('Jeu non joignable, nouvel essai toutes les 3s...')
    waiting = true
    setTimeout(connect, 3000)
  })
  ws.on('error', () => {})
}

process.on('SIGINT', () => {
  console.log(`\nTrames : ${framesFile}\nRésumés : ${matchesFile}`)
  try {
    const all = JSON.parse(fs.readFileSync(playlistsFile, 'utf8'))
    console.log(`\nPlaylistId vus (${playlistsFile}) — complète le champ "label" avec le mode que tu avais choisi :`)
    for (const [id, e] of Object.entries(all)) {
      console.log(`  ${id.padStart(3)}  ${String(e.count).padStart(3)} match(s)  ${e.formats.join(', ').padEnd(10)} ${e.label || e.hint || 'inconnu'}`)
    }
  } catch {}
  frames.end(() => process.exit(0))
})

console.log(`RL Studio — observation (${FULL ? 'toutes les trames' : 'enregistrement allégé'})`)
connect()
