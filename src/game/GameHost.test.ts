import { describe, expect, it } from 'vitest'
import { createGameHost, GameCloseTimeoutError, LAUNCH_URLS } from './GameHost'

const win = process.platform === 'win32'

function host(running: () => boolean, calls: string[] = []): ReturnType<typeof createGameHost> {
  return createGameHost({
    openExternal: async (url) => void calls.push('open ' + url),
    closeTimeoutMs: 400,
    exec: async (file, args) => {
      calls.push([file, ...args].join(' '))
      return file === 'tasklist' && running() ? '"RocketLeague.exe","1234"' : 'INFO: aucune tâche'
    }
  })
}

describe('createGameHost', () => {
  it.runIf(win)('détecte le processus avec tasklist', async () => {
    expect(await host(() => true).isRunning()).toBe(true)
    expect(await host(() => false).isRunning()).toBe(false)
  })

  it.runIf(win)('ferme le jeu sans /F puis attend son départ', async () => {
    let alive = true
    const calls: string[] = []
    const h = createGameHost({
      openExternal: async () => {},
      closeTimeoutMs: 2000,
      exec: async (file, args) => {
        calls.push([file, ...args].join(' '))
        if (file === 'taskkill') alive = false
        return file === 'tasklist' && alive ? '"RocketLeague.exe","1234"' : ''
      }
    })
    await h.closeGame()
    expect(calls).toContain('taskkill /IM RocketLeague.exe')
    expect(calls.filter((c) => c.startsWith('taskkill')).some((c) => c.includes('/F'))).toBe(false)
  })

  it.runIf(win)('échoue si le jeu ne se ferme pas', async () => {
    await expect(host(() => true).closeGame()).rejects.toThrow(GameCloseTimeoutError)
  })

  it('lance via l’URL de la boutique', async () => {
    const calls: string[] = []
    await host(() => false, calls).launch('steam')
    await host(() => false, calls).launch('epic')
    expect(calls).toEqual([`open ${LAUNCH_URLS.steam}`, `open ${LAUNCH_URLS.epic}`])
    expect(LAUNCH_URLS.steam).toBe('steam://rungameid/252950')
  })
})
