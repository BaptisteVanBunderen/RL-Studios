import { describe, expect, it } from 'vitest'
import {
  applyStatsApiIni,
  deriveConnectionStatus,
  isValidPacketSendRate,
  launcherFromPath,
  parseStatsApiIni
} from './gameSetup'

const INI = '[TAGame.MatchStatsExporter_TA]\r\nPort=49123\r\nPacketSendRate=0\r\nWebPort=49124\r\n'

describe('parseStatsApiIni', () => {
  it('lit les trois clés de la section', () => {
    expect(parseStatsApiIni(INI)).toEqual({ packetSendRate: 0, port: 49123, webPort: 49124 })
  })

  it('ignore les clés des autres sections et tolère casse et espaces', () => {
    const text =
      '[Autre]\nPacketSendRate=99\n[tagame.matchstatsexporter_ta]\n packetsendrate = 30 \n'
    expect(parseStatsApiIni(text)).toEqual({ packetSendRate: 30, port: null, webPort: null })
  })

  it('renvoie null pour une valeur absente ou illisible', () => {
    expect(parseStatsApiIni('')).toEqual({ packetSendRate: null, port: null, webPort: null })
    const bad = '[TAGame.MatchStatsExporter_TA]\nPacketSendRate=abc'
    expect(parseStatsApiIni(bad).packetSendRate).toBeNull()
  })
})

describe('applyStatsApiIni', () => {
  it('remplace la valeur en gardant les fins de ligne et les autres clés', () => {
    expect(applyStatsApiIni(INI, { packetSendRate: 30 })).toBe(
      '[TAGame.MatchStatsExporter_TA]\r\nPort=49123\r\nPacketSendRate=30\r\nWebPort=49124\r\n'
    )
  })

  it('ajoute la clé à la fin de sa section, avant la section suivante', () => {
    const text = '[TAGame.MatchStatsExporter_TA]\nPort=49123\n\n[Suite]\nA=1\n'
    expect(applyStatsApiIni(text, { packetSendRate: 60 })).toBe(
      '[TAGame.MatchStatsExporter_TA]\nPort=49123\nPacketSendRate=60\n\n[Suite]\nA=1\n'
    )
  })

  it('crée la section dans un fichier qui ne l’a pas', () => {
    const out = applyStatsApiIni('[Autre]\nA=1\n', { packetSendRate: 30 })
    expect(out).toBe('[Autre]\nA=1\n\n[TAGame.MatchStatsExporter_TA]\nPacketSendRate=30\n')
    expect(parseStatsApiIni(out).packetSendRate).toBe(30)
  })

  it('fonctionne sur un fichier vide et est idempotent', () => {
    const once = applyStatsApiIni('', { packetSendRate: 30 })
    expect(once).toBe('[TAGame.MatchStatsExporter_TA]\nPacketSendRate=30\n')
    expect(applyStatsApiIni(once, { packetSendRate: 30 })).toBe(once)
  })

  it('ne touche à rien sans changement demandé', () => {
    expect(applyStatsApiIni(INI, {})).toBe(INI)
  })
})

describe('statut et validation', () => {
  it('distingue connecté, jeu lancé sans API et jeu fermé', () => {
    expect(deriveConnectionStatus(true, true)).toBe('connected')
    expect(deriveConnectionStatus(false, true)).toBe('api-disabled')
    expect(deriveConnectionStatus(false, false)).toBe('game-closed')
  })

  it('valide le débit de paquets (entier de 0 à 120)', () => {
    for (const ok of [0, 1, 30, 120]) expect(isValidPacketSendRate(ok)).toBe(true)
    for (const bad of [-1, 121, 1.5, NaN, '30', null])
      expect(isValidPacketSendRate(bad)).toBe(false)
  })

  it('reconnaît la boutique d’après le chemin', () => {
    expect(launcherFromPath('D:\\SteamLibrary\\steamapps\\common\\rocketleague')).toBe('steam')
    expect(launcherFromPath('C:\\Program Files\\Epic Games\\rocketleague')).toBe('epic')
    expect(launcherFromPath('E:\\Jeux\\RL')).toBeNull()
  })
})
