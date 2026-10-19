// Exemple d'overlay : tout passe par RLStudio.on(topic, fonction).
// Les topics reçus sont ceux déclarés dans le champ "data" du manifest.json.

function byId(id) {
  return document.getElementById(id)
}

// Réglages du module : valeurs par défaut du manifeste, puis celles de l'utilisateur.
// Rappelé à chaque modification, sans rechargement de la page.
RLStudio.on('settings', function (settings) {
  var root = document.documentElement
  root.style.setProperty('--win-color', settings.winColor)
  root.style.setProperty('--bg-opacity', String(settings.bgOpacity))
  byId('score').hidden = !settings.showScore
})

// Session : { wins, losses, streak, bestStreak, lastResult }. `streak` est signée (négative = défaites).
RLStudio.on('session', function (session) {
  byId('wins').textContent = session.wins
  byId('losses').textContent = session.losses
  byId('streak').textContent = (session.streak > 0 ? '+' : '') + session.streak
})

// Match en cours, ou null entre deux matchs. Le score affiché commence par mon équipe.
RLStudio.on('match', function (match) {
  var score = byId('score')
  if (!match || match.teams.length < 2) {
    score.textContent = ''
    return
  }
  var mine = match.teams.find(function (t) {
    return t.teamNum === match.myTeamNum
  })
  var theirs = match.teams.find(function (t) {
    return t.teamNum !== match.myTeamNum
  })
  // Équipe du joueur inconnue : on affiche bleu - orange.
  var a = mine || match.teams[0]
  var b = theirs || match.teams[1]
  score.textContent = a.score + ' – ' + b.score
})

// { status: 'game-closed' | 'api-disabled' | 'connected' }
RLStudio.on('connection', function (connection) {
  byId('link').className = 'dot' + (connection.status === 'connected' ? ' connected' : '')
})
