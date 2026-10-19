import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_PORT, DEFAULT_OVERLAY_PORT, defaultConfig, parseConfig } from './config'

describe('parseConfig', () => {
  it('une config vide ou illisible donne la config par défaut', () => {
    for (const raw of [undefined, null, 42, 'texte', [], {}]) {
      expect(parseConfig(raw)).toEqual(defaultConfig())
    }
  })

  it('les ports par défaut sont ceux de l’API et du serveur', () => {
    expect(defaultConfig()).toMatchObject({ overlayPort: 49200, gameWebPort: 49124 })
    expect(DEFAULT_OVERLAY_PORT).toBe(49200)
    expect(DEFAULT_GAME_PORT).toBe(49124)
  })

  it('garde les valeurs valides', () => {
    const raw = {
      version: 1,
      overlayPort: 50000,
      gameWebPort: 49999,
      localPlayerId: 'Epic|abc|0',
      modules: { 'session-tracker/bar': { enabled: true } }
    }
    expect(parseConfig(raw)).toEqual(raw)
  })

  it('un champ invalide redevient son défaut SANS perdre les autres', () => {
    const config = parseConfig({
      overlayPort: 'abc',
      gameWebPort: 50001,
      localPlayerId: 'Epic|abc|0'
    })
    expect(config).toMatchObject({
      overlayPort: DEFAULT_OVERLAY_PORT,
      gameWebPort: 50001,
      localPlayerId: 'Epic|abc|0'
    })
  })

  it.each([80, 70000, 1023, 49200.5, -1, '49200', null])('port invalide %j → défaut', (bad) => {
    expect(parseConfig({ overlayPort: bad }).overlayPort).toBe(DEFAULT_OVERLAY_PORT)
  })

  it('localPlayerId : chaîne non vide ou null', () => {
    expect(parseConfig({ localPlayerId: '' }).localPlayerId).toBeNull()
    expect(parseConfig({ localPlayerId: 12 }).localPlayerId).toBeNull()
    expect(parseConfig({ localPlayerId: null }).localPlayerId).toBeNull()
  })

  it('modules : ignore les clés invalides, répare les valeurs invalides', () => {
    const { modules } = parseConfig({
      modules: {
        'pack/ok': { enabled: true },
        'pack/pas-bool': { enabled: 'oui' },
        'pack/vide': {},
        'pack/nul': null,
        'Pas Valide': { enabled: true },
        'trop/de/segments': { enabled: true },
        'sans-module': { enabled: true }
      }
    })
    expect(modules).toEqual({
      'pack/ok': { enabled: true },
      'pack/pas-bool': { enabled: false },
      'pack/vide': { enabled: false },
      'pack/nul': { enabled: false }
    })
  })

  it('modules qui n’est pas un objet → aucun module', () => {
    expect(parseConfig({ modules: [1, 2] }).modules).toEqual({})
    expect(parseConfig({ modules: 'x' }).modules).toEqual({})
  })

  it('conserve les clés inconnues (une version plus récente ne perd rien)', () => {
    const config = parseConfig({ overlayPort: 50000, hotkey: 'F9' }) as unknown as Record<
      string,
      unknown
    >
    expect(config.hotkey).toBe('F9')
    expect(config.overlayPort).toBe(50000)
  })

  it('conserve les clés inconnues d’un module', () => {
    const { modules } = parseConfig({ modules: { 'a/b': { enabled: true, scale: 1.5 } } })
    expect(modules['a/b']).toEqual({ enabled: true, scale: 1.5 })
  })

  it('renvoie un objet neuf à chaque appel (pas de partage d’état)', () => {
    const a = defaultConfig()
    a.modules['x/y'] = { enabled: true }
    expect(defaultConfig().modules).toEqual({})
  })
})
