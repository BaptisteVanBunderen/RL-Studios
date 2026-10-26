import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { OverlayMessage, PacksSnapshot } from '@core/index'
import { createDemoPack } from '@server/test-utils/fixtures'
import { Services } from './services'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor : délai dépassé')
    await sleep(10)
  }
}

describe('Services : valeurs des réglages d’un module', () => {
  let base: string
  let configFile: string
  const started: Services[] = []
  const sockets: WebSocket[] = []

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'rl-studio-settings-'))
    configFile = join(base, 'userData', 'config.json')
    await createDemoPack(base) // module demo/bar : réglage « color » (défaut #ff0000)
  })
  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate()
    for (const s of started.splice(0)) await s.stop()
    await rm(base, { recursive: true, force: true })
  })

  async function create(): Promise<Services> {
    const services = new Services({
      configFile,
      overlaysDir: join(base, 'overlays'),
      sdkSource: '',
      overlayPort: 0,
      gameWebPort: 1 // jamais ouvert : ne touche pas au vrai jeu
    })
    started.push(services)
    await services.start()
    return services
  }

  async function overlay(services: Services, module: string): Promise<OverlayMessage[]> {
    const messages: OverlayMessage[] = []
    const ws = new WebSocket(`ws://127.0.0.1:${services.server.port}/ws?module=${module}`)
    sockets.push(ws)
    ws.on('message', (d) => messages.push(JSON.parse(d.toString())))
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('error', reject)
    })
    return messages
  }

  const bar = (snapshot: PacksSnapshot): PacksSnapshot['packs'][number]['modules'][number] =>
    snapshot.packs[0].modules.find((m) => m.id === 'bar')!

  it('sans choix de l’utilisateur : les valeurs sont les défauts du manifeste', async () => {
    const services = await create()
    expect(bar(services.getState().packs).values).toEqual({ color: '#ff0000' })
  })

  it('enregistre une valeur valide, l’annonce et la renvoie dans l’instantané', async () => {
    const services = await create()
    const announced: PacksSnapshot[] = []
    services.onPacks((p) => announced.push(p))

    const snapshot = await services.setModuleSetting('demo/bar', 'color', '#00ff00')

    expect(bar(snapshot).values).toEqual({ color: '#00ff00' })
    expect(announced).toHaveLength(1)
  })

  it('l’overlay ouvert reçoit la nouvelle valeur tout de suite, sans rechargement', async () => {
    const services = await create()
    const messages = await overlay(services, 'demo/bar')
    await waitFor(() => messages.some((m) => m.type === 'settings'))
    expect(messages.find((m) => m.type === 'settings')?.payload).toEqual({ color: '#ff0000' })

    await services.setModuleSetting('demo/bar', 'color', '#0000ff')

    await waitFor(() => messages.filter((m) => m.type === 'settings').length === 2)
    expect(messages.filter((m) => m.type === 'settings')[1].payload).toEqual({ color: '#0000ff' })
  })

  it('un overlay qui se connecte ensuite reçoit la valeur enregistrée, pas le défaut', async () => {
    const services = await create()
    await services.setModuleSetting('demo/bar', 'color', '#123456')
    const messages = await overlay(services, 'demo/bar')
    await waitFor(() => messages.length >= 1)
    expect(messages[0]).toEqual({ v: 1, type: 'settings', payload: { color: '#123456' } })
  })

  it('persiste d’un lancement à l’autre', async () => {
    const first = await create()
    await first.setModuleSetting('demo/bar', 'color', '#abcdef')
    await first.stop()
    expect(JSON.parse(await readFile(configFile, 'utf8')).modules['demo/bar'].settings).toEqual({
      color: '#abcdef'
    })

    const second = await create()
    expect(bar(second.getState().packs).values).toEqual({ color: '#abcdef' })
  })

  it('ne change ni l’activation ni la position du module', async () => {
    const services = await create()
    await services.setModuleEnabled('demo/bar', true)
    await services.setModulePlacement('demo/bar', { scale: 2 })
    await services.setModuleSetting('demo/bar', 'color', '#00ff00')
    expect(services.config.config.modules['demo/bar']).toMatchObject({ enabled: true, scale: 2 })
  })

  it('un module jamais activé garde enabled: false', async () => {
    const services = await create()
    await services.setModuleSetting('demo/bar', 'color', '#00ff00')
    expect(services.config.config.modules['demo/bar'].enabled).toBe(false)
  })

  it.each(['rouge', '#fff', 12, true, ''])(
    'refuse la valeur %j, sans rien enregistrer',
    async (value) => {
      const services = await create()
      await expect(services.setModuleSetting('demo/bar', 'color', value as never)).rejects.toThrow(
        'Valeur refusée pour « Couleur »'
      )
      expect(services.config.config.modules['demo/bar']).toBeUndefined()
    }
  )

  it('refuse un réglage inconnu et un module inconnu', async () => {
    const services = await create()
    await expect(services.setModuleSetting('demo/bar', 'inconnu', 1)).rejects.toThrow(
      'Réglage inconnu'
    )
    await expect(services.setModuleSetting('demo/inconnu', 'color', '#000000')).rejects.toThrow(
      'Module introuvable'
    )
    await expect(services.setModuleSetting('../x', 'color', '#000000')).rejects.toThrow(
      'Module introuvable'
    )
  })

  it('une valeur enregistrée devenue invalide (manifeste modifié) retombe sur le défaut', async () => {
    const first = await create()
    await first.setModuleSetting('demo/bar', 'color', '#00ff00')
    await first.stop()

    // La config est éditée à la main avec une valeur que le manifeste n'accepte pas.
    const saved = JSON.parse(await readFile(configFile, 'utf8'))
    saved.modules['demo/bar'].settings.color = 'pas une couleur'
    const { writeFile } = await import('node:fs/promises')
    await writeFile(configFile, JSON.stringify(saved))

    const second = await create()
    expect(bar(second.getState().packs).values).toEqual({ color: '#ff0000' })
  })
})
