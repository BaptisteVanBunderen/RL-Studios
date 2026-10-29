import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PackLoader } from './packs/PackLoader'

describe('packs livrés avec l’application (dossier overlays/)', () => {
  const loader = new PackLoader(join(process.cwd(), 'overlays'))

  it('sont tous valides, sans erreur ni avertissement', async () => {
    const { packs, invalid } = await loader.scan()
    expect(invalid).toEqual([])
    expect(packs.length).toBeGreaterThan(0)
    for (const pack of packs) expect(pack.warnings, pack.id).toEqual([])
  })

  it('contiennent le pack d’exemple et la barre de session', async () => {
    const { packs } = await loader.scan()
    expect(packs.map((p) => p.id)).toEqual(
      expect.arrayContaining(['example', 'tracker-session', 'scoreboard', 'match-stats'])
    )
  })

  it('tracker-session : un module bar-slice 425 × 47 qui ne demande que la session', async () => {
    const { packs } = await loader.scan()
    const module = packs.find((p) => p.id === 'tracker-session')?.manifest.modules[0]
    expect(module).toMatchObject({
      id: 'bar-slice',
      size: { width: 425, height: 47 },
      data: ['session'],
      defaultPosition: { anchor: 'top-right' }
    })
    expect(module?.settings.map((s) => s.key)).toEqual([
      'showWinrate',
      'showBest',
      'showLossStreak',
      'goodWinrate',
      'bgOpacity'
    ])
  })

  it('scoreboard : un module board qui ne demande que le match, 7 réglages valides', async () => {
    const { packs } = await loader.scan()
    const module = packs.find((p) => p.id === 'scoreboard')?.manifest.modules[0]
    expect(module).toMatchObject({ id: 'board', data: ['match'] })
    expect(module?.settings.map((s) => s.key)).toEqual([
      'showTimer',
      'showStats',
      'highlightMe',
      'hideOutsideMatch',
      'blueColor',
      'orangeColor',
      'bgOpacity'
    ])
  })

  it('match-stats : quatre modules, chacun ne demande que les topics utiles', async () => {
    const { packs } = await loader.scan()
    const modules = packs.find((p) => p.id === 'match-stats')?.manifest.modules ?? []
    expect(modules.map((m) => [m.id, m.data])).toEqual([
      ['demos', ['match', 'session']],
      ['ball-speed', ['match', 'event']],
      ['accuracy', ['match', 'session']],
      ['boost', ['match']]
    ])
  })

  it('chaque module livré déclare son genre (panneau d’aide du client)', async () => {
    const { packs } = await loader.scan()
    const categories = Object.fromEntries(
      packs.flatMap((p) => p.manifest.modules.map((m) => [`${p.id}/${m.id}`, m.category]))
    )
    expect(categories).toEqual({
      'example/session': 'session',
      'tracker-session/bar-slice': 'session',
      'scoreboard/board': 'match',
      'match-stats/demos': 'stats',
      'match-stats/ball-speed': 'match',
      'match-stats/accuracy': 'stats',
      'match-stats/boost': 'match'
    })
  })

  it('aucun overlay livré ne parle l’ancien protocole ni ne dépend du port 8765', async () => {
    const { readFile, readdir } = await import('node:fs/promises')
    const root = join(process.cwd(), 'overlays')
    const files: string[] = []
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) await walk(path)
        else if (/\.(html|js)$/.test(entry.name)) files.push(path)
      }
    }
    await walk(root)

    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const text = await readFile(file, 'utf8')
      expect(text, file).not.toMatch(/localhost:8765|127\.0\.0\.1:8765|new WebSocket\(/)
    }
  })
})
