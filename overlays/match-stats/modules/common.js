// Fonctions communes aux modules du pack « Stats de match ». ES2015 seulement (vieux OBS).
var Stats = (function () {
  // Le joueur local dans l'état du match (null hors match, ou tant qu'il n'est pas identifié).
  function localPlayer(match) {
    if (!match || match.localPlayerId === null) return null
    return (
      match.players.find(function (p) {
        return p.primaryId === match.localPlayerId
      }) || null
    )
  }

  // Statistiques du joueur local sur le match en cours.
  function matchStats(match) {
    var me = localPlayer(match)
    return {
      goals: me ? me.goals : 0,
      assists: me ? me.assists : 0,
      saves: me ? me.saves : 0,
      shots: me ? me.shots : 0,
      demos: me ? me.demos : 0,
      demosTaken: match ? match.demosTaken : 0
    }
  }

  // Totaux de la session : chaque tir, but, passe, arrêt ou démolition s'y ajoute dès qu'il se
  // produit (topic `session`), rien à recalculer ici.
  function sessionStats(session) {
    return session.stats
  }

  // Pourcentage de buts sur tirs, entier ; « – » sans tir.
  function accuracy(goals, shots) {
    return shots > 0 ? Math.round((goals / shots) * 100) + '%' : '–'
  }

  // Met à jour un texte ; l'animation ne joue que si la valeur change vraiment.
  function setText(el, value) {
    var text = String(value)
    if (el.textContent === text) return
    el.textContent = text
    el.classList.remove('pop')
    void el.offsetWidth
    el.classList.add('pop')
  }

  return {
    localPlayer: localPlayer,
    matchStats: matchStats,
    sessionStats: sessionStats,
    accuracy: accuracy,
    setText: setText
  }
})()
