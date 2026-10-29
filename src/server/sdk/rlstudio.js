/*
 * RL Studio : SDK des overlays.
 *
 * À inclure dans la page d'un overlay :
 *   <script src="/sdk/rlstudio.js"></script>
 *
 * Servi tel quel par le serveur local de RL Studio, sans étape de build : même fonctionnement
 * dans l'application et dans OBS (source navigateur). Il se connecte tout seul, se reconnecte
 * si l'application redémarre, et reconnaît son module d'après l'URL de la page
 * (/overlay/<pack>/<module>).
 *
 *   RLStudio.on('settings',   function (values)  { ... })  // valeurs des réglages du module
 *   RLStudio.on('session',    function (session) { ... })  // { wins, losses, streak, bestStreak, lastResult, stats }
 *   RLStudio.on('match',      function (match)   { ... })  // état du match, ou null entre deux matchs
 *   RLStudio.on('event',      function (event)   { ... })  // but, fin de match… (ponctuel)
 *   RLStudio.on('connection', function (c)       { ... })  // { status: 'game-closed' | 'api-disabled' | 'connected' }
 *
 * `on` renvoie une fonction pour se désabonner. Un abonné tardif reçoit tout de suite la dernière
 * valeur connue des topics d'état (pas des events : un but ne se rejoue pas).
 *
 * Écrit en ES2015 simple (ni `?.` ni `??`) : les anciennes versions d'OBS embarquent un
 * Chromium ancien.
 */
;(function (global) {
  'use strict'

  if (global.RLStudio) return

  var PROTOCOL_VERSION = 1
  var RETRY_MIN_MS = 500
  var RETRY_MAX_MS = 5000

  // Topics dont la dernière valeur est mémorisée (tous sauf `event`).
  var STATE_TOPICS = { settings: true, session: true, match: true, connection: true }

  var handlers = {} // topic -> [fonctions]
  var last = {} // topic -> { payload }
  var socket = null
  var retryDelay = RETRY_MIN_MS
  var retryTimer = null

  /** `pack/module` d'après l'URL de la page, ou `?module=pack/module` pour un test hors serveur. */
  function moduleFromLocation() {
    var path = global.location && global.location.pathname
    var match = /^\/overlay\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/.exec(path || '')
    if (match) return match[1] + '/' + match[2]

    var query = /[?&]module=([^&]+)/.exec((global.location && global.location.search) || '')
    return query ? decodeURIComponent(query[1]) : null
  }

  function socketUrl(moduleKey) {
    var scheme = global.location.protocol === 'https:' ? 'wss://' : 'ws://'
    var query = moduleKey ? '?module=' + encodeURIComponent(moduleKey) : ''
    return scheme + global.location.host + '/ws' + query
  }

  function call(fn, payload) {
    try {
      fn(payload)
    } catch (error) {
      // Un abonné défaillant ne doit pas couper les autres ni la connexion.
      if (global.console) global.console.error('RLStudio : erreur dans un abonné', error)
    }
  }

  function dispatch(message) {
    if (!message || message.v !== PROTOCOL_VERSION || typeof message.type !== 'string') return

    if (STATE_TOPICS[message.type] === true) last[message.type] = { payload: message.payload }

    var list = handlers[message.type]
    if (!list) return
    list.slice().forEach(function (fn) {
      call(fn, message.payload)
    })
  }

  function connect() {
    retryTimer = null
    if (typeof global.WebSocket !== 'function') return

    var ws = new global.WebSocket(socketUrl(moduleKey))
    socket = ws

    ws.onopen = function () {
      retryDelay = RETRY_MIN_MS
    }

    ws.onmessage = function (event) {
      var message
      try {
        message = JSON.parse(event.data)
      } catch (error) {
        return // message illisible : ignoré
      }
      dispatch(message)
    }

    ws.onclose = function () {
      if (socket !== ws) return
      socket = null
      scheduleRetry()
    }

    // `onerror` est toujours suivi de `onclose` : la reprise se fait là.
    ws.onerror = function () {}
  }

  function scheduleRetry() {
    if (retryTimer !== null) return
    var delay = retryDelay
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)
    retryTimer = global.setTimeout(connect, delay)
  }

  function on(topic, fn) {
    if (typeof topic !== 'string' || typeof fn !== 'function') {
      throw new TypeError('RLStudio.on(topic, fonction) : topic (texte) et fonction attendus')
    }
    ;(handlers[topic] = handlers[topic] || []).push(fn)

    // Abonné tardif : la dernière valeur connue part tout de suite.
    if (STATE_TOPICS[topic] === true && last[topic]) call(fn, last[topic].payload)

    return function () {
      off(topic, fn)
    }
  }

  function off(topic, fn) {
    var list = handlers[topic]
    if (!list) return
    var index = list.indexOf(fn)
    if (index !== -1) list.splice(index, 1)
  }

  var moduleKey = moduleFromLocation()

  global.RLStudio = {
    version: PROTOCOL_VERSION,
    /** `pack/module` de cette page, ou null. */
    module: moduleKey,
    on: on,
    off: off
  }

  connect()
})(typeof window !== 'undefined' ? window : this)
