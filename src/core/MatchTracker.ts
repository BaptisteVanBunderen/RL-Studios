import type { GameEvent, StatfeedEvent, UpdateEvent } from './events'
import type { MatchResult, MatchState, MatchStats, ResultKind } from './match'

export interface TrackerOptions {
  localPlayerId?: string | null
}

export interface TrackerUpdate {
  matchChanged: boolean
  result: MatchResult | null
  /**
   * Ce que le joueur local vient de faire en plus (tir, but, démolition…), pour la session :
   * chaque nouvelle valeur s'ajoute, rien n'est recalculé à la fin du match.
   */
  statsDelta: { delta: MatchStats; playlistId: number | null } | null
}

interface Current {
  guid: string
  playlistId: number | null
  finished: boolean
  winnerTeamNum: number | null
  statfeedWinTeam: number | null
  myTeam: number | null
  maxBallSpeed: number
  /** Plus hautes valeurs vues pour le joueur local sur ce match (sert à calculer les variations). */
  tally: MatchStats
  lastUpdate: UpdateEvent
}

const COUNTED_KEYS = ['goals', 'assists', 'saves', 'shots', 'demos'] as const

function emptyTally(): MatchStats {
  return { goals: 0, assists: 0, saves: 0, shots: 0, demos: 0, demosTaken: 0 }
}

function isValidTeam(team: number | null | undefined): team is number {
  return team === 0 || team === 1
}

export class MatchTracker {
  private localId: string | null
  private current: Current | null = null
  private historyReplay = false
  /**
   * Valeurs déjà comptées, par GUID : si le jeu renvoie un état d'un match déjà détruit, il reprend
   * là où il en était au lieu de tout recompter.
   */
  private readonly tallies = new Map<string, MatchStats>()

  constructor(options: TrackerOptions = {}) {
    this.localId = options.localPlayerId ?? null
  }

  get localPlayerId(): string | null {
    return this.localId
  }

  get match(): MatchState | null {
    return this.current ? this.buildState(this.current) : null
  }

  get inHistoryReplay(): boolean {
    return this.historyReplay
  }

  setLocalPlayerId(primaryId: string | null): void {
    this.localId = primaryId
  }

  handle(event: GameEvent): TrackerUpdate {
    const out: TrackerUpdate = { matchChanged: false, result: null, statsDelta: null }

    if (event.type === 'replayCreated') {
      this.historyReplay = true
      return out
    }
    if (event.type === 'update') {
      if (event.isHistoryReplay) {
        this.historyReplay = true
        return out
      }
      this.historyReplay = false
    } else if (this.historyReplay) {
      return out
    }

    switch (event.type) {
      case 'update':
        this.onUpdate(event, out)
        break
      case 'statfeed':
        this.onStatfeed(event, out)
        break
      case 'matchEnded':
        this.onMatchEnded(event.matchGuid, event.winnerTeamNum, out)
        break
      case 'matchDestroyed':
        this.onMatchDestroyed(out)
        break
      default:
        break
    }
    return out
  }

  private onUpdate(event: UpdateEvent, out: TrackerUpdate): void {
    if (this.localId === null && !event.isReplay && event.target?.primaryId) {
      this.localId = event.target.primaryId
    }

    if (this.current && !this.isSameMatch(this.current, event)) {
      out.result = this.settleUnfinished(this.current)
      this.current = null
    }
    if (!this.current) {
      this.current = {
        guid: event.matchGuid,
        playlistId: event.playlistId,
        finished: false,
        winnerTeamNum: null,
        statfeedWinTeam: null,
        myTeam: null,
        maxBallSpeed: 0,
        tally: this.tallyFor(event.matchGuid),
        lastUpdate: event
      }
    }
    const cur = this.current

    if (cur.guid === '' && event.matchGuid !== '') {
      cur.guid = event.matchGuid
      if (!this.tallies.has(cur.guid)) this.tallies.set(cur.guid, cur.tally)
    }
    if (event.playlistId !== null) cur.playlistId = event.playlistId

    if (!event.isReplay) {
      const fromPlayers = this.localId
        ? event.players.find((p) => p.primaryId === this.localId)?.teamNum
        : undefined
      const team = isValidTeam(fromPlayers) ? fromPlayers : event.target?.teamNum
      if (isValidTeam(team)) cur.myTeam = team
    }

    // Chaque tir, but, passe, arrêt ou démolition de plus s'ajoute à la session.
    const me = this.localId ? event.players.find((p) => p.primaryId === this.localId) : undefined
    if (me) {
      const delta = emptyTally()
      let changed = false
      for (const key of COUNTED_KEYS) {
        if (me[key] > cur.tally[key]) {
          delta[key] = me[key] - cur.tally[key]
          cur.tally[key] = me[key]
          changed = true
        }
      }
      if (changed) out.statsDelta = { delta, playlistId: cur.playlistId }
    }

    // Pendant un replay de but, la balle rejoue d'anciennes vitesses : on ne les compte pas.
    if (!event.isReplay) cur.maxBallSpeed = Math.max(cur.maxBallSpeed, event.ballSpeed)

    cur.lastUpdate = event
    out.matchChanged = true
  }

  private onStatfeed(event: StatfeedEvent, out: TrackerUpdate): void {
    const cur = this.current
    if (!cur || cur.finished) return

    if (event.name === 'Demolish') {
      // La cible d'un statfeed n'a pas de PrimaryId : on la retrouve par son raccourci de match.
      const me = this.localPlayer(cur)
      const victim = event.secondaryTarget
      if (me && victim && victim.shortcut === me.shortcut && victim.name === me.name) {
        cur.tally.demosTaken++
        out.statsDelta = {
          delta: { ...emptyTally(), demosTaken: 1 },
          playlistId: cur.playlistId
        }
      }
      return
    }

    if (event.name !== 'Win') return
    const team = event.mainTarget?.teamNum
    if (cur.statfeedWinTeam === null && isValidTeam(team)) cur.statfeedWinTeam = team
  }

  private localPlayer(cur: Current): UpdateEvent['players'][number] | undefined {
    return this.localId === null
      ? undefined
      : cur.lastUpdate.players.find((p) => p.primaryId === this.localId)
  }

  private tallyFor(guid: string): MatchStats {
    return (guid !== '' && this.tallies.get(guid)) || emptyTally()
  }

  private onMatchEnded(guid: string, winnerTeamNum: number, out: TrackerUpdate): void {
    const cur = this.current
    if (!cur || cur.finished) return

    if (cur.guid === '' && guid !== '') cur.guid = guid
    cur.finished = true
    cur.winnerTeamNum = winnerTeamNum
    out.matchChanged = true
    out.result = this.buildResult(cur, 'matchEnded', winnerTeamNum)
  }

  private onMatchDestroyed(out: TrackerUpdate): void {
    if (!this.current) return
    out.result = this.settleUnfinished(this.current)
    this.current = null
    out.matchChanged = true
  }

  private isSameMatch(cur: Current, event: UpdateEvent): boolean {
    if (cur.guid !== '' && event.matchGuid !== '') return cur.guid === event.matchGuid
    return (
      cur.playlistId === null || event.playlistId === null || cur.playlistId === event.playlistId
    )
  }

  private settleUnfinished(cur: Current): MatchResult | null {
    if (cur.finished) return null
    if (cur.statfeedWinTeam !== null) return this.buildResult(cur, 'statfeed', cur.statfeedWinTeam)
    return this.buildResult(cur, 'abandon', null)
  }

  private buildResult(
    cur: Current,
    kind: ResultKind,
    winnerTeamNum: number | null
  ): MatchResult | null {
    let won = false
    if (winnerTeamNum !== null) {
      if (cur.myTeam === null) return null
      won = winnerTeamNum === cur.myTeam
    }
    return {
      matchGuid: cur.guid,
      won,
      playlistId: cur.playlistId,
      kind,
      myTeamNum: cur.myTeam,
      winnerTeamNum
    }
  }

  private buildState(cur: Current): MatchState {
    const event = cur.lastUpdate
    return {
      matchGuid: cur.guid,
      playlistId: cur.playlistId,
      status: cur.finished ? 'ended' : 'inProgress',
      timeSeconds: event.timeSeconds,
      overtime: event.overtime,
      isReplay: event.isReplay,
      teams: event.teams,
      players: event.players,
      localPlayerId: this.localId,
      myTeamNum: cur.myTeam,
      winnerTeamNum: cur.winnerTeamNum,
      ballSpeed: event.ballSpeed,
      maxBallSpeed: cur.maxBallSpeed,
      demosTaken: cur.tally.demosTaken
    }
  }
}
