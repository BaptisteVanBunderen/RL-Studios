import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  detectInstalls,
  locateIni,
  parseEpicManifest,
  parseSteamLibraries,
  readStatsApiIni,
  restoreStatsApiIni,
  writeStatsApiIni
} from './GameSetup'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rl-setup-'))
})
afterEach(() => rm(root, { recursive: true, force: true }))

async function fakeGame(dir: string, ini?: { name: string; text: string }): Promise<string> {
  await mkdir(join(dir, 'TAGame', 'Config'), { recursive: true })
  if (ini) await writeFile(join(dir, 'TAGame', 'Config', ini.name), ini.text)
  return dir
}

const INI = '[TAGame.MatchStatsExporter_TA]\r\nPacketSendRate=0\r\nPort=49123\r\nWebPort=49124\r\n'

describe('parseSteamLibraries / parseEpicManifest', () => {
  it('lit les bibliothèques Steam', () => {
    const vdf =
      '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\Jeux\\\\Steam"\n\t}\n}'
    expect(parseSteamLibraries(vdf)).toEqual(['C:\\Steam', 'D:\\Jeux\\Steam'])
  })

  it('trouve Rocket League (Sugar) dans le manifeste Epic', () => {
    const json = JSON.stringify({
      InstallationList: [
        { AppName: 'Fortnite', InstallLocation: 'C:\\Epic\\Fortnite' },
        { AppName: 'Sugar', InstallLocation: 'E:\\Epic\\rocketleague' }
      ]
    })
    expect(parseEpicManifest(json)).toEqual(['E:\\Epic\\rocketleague'])
    expect(parseEpicManifest('pas du json')).toEqual([])
  })
})

describe('detectInstalls', () => {
  it('trouve Steam (défaut et bibliothèque secondaire) et Epic, sans doublon', async () => {
    const steam = join(root, 'Steam')
    const library = join(root, 'Lib')
    await mkdir(join(steam, 'steamapps'), { recursive: true })
    await fakeGame(join(steam, 'steamapps', 'common', 'rocketleague'))
    await fakeGame(join(library, 'steamapps', 'common', 'rocketleague'))
    const escape = (p: string): string => p.replace(/\\/g, '\\\\')
    await writeFile(
      join(steam, 'steamapps', 'libraryfolders.vdf'),
      `"path" "${escape(library)}"\n"path" "${escape(steam)}"`
    )
    const epic = await fakeGame(join(root, 'Epic Games', 'rocketleague'))
    const manifest = join(root, 'LauncherInstalled.dat')
    await writeFile(
      manifest,
      JSON.stringify({ InstallationList: [{ AppName: 'Sugar', InstallLocation: epic }] })
    )

    const found = await detectInstalls({
      steamRoots: [steam],
      epicManifest: manifest,
      fallbackDirs: [epic]
    })
    expect(found.map((i) => i.launcher)).toEqual(['steam', 'steam', 'epic'])
    expect(new Set(found.map((i) => i.dir)).size).toBe(3)
  })

  it('ignore un dossier sans TAGame\\Config et ne plante pas si rien n’existe', async () => {
    await mkdir(join(root, 'vide'))
    expect(
      await detectInstalls({
        steamRoots: [join(root, 'nope')],
        epicManifest: join(root, 'nope.dat'),
        fallbackDirs: [join(root, 'vide')]
      })
    ).toEqual([])
  })
})

describe('fichier ini de la Stats API', () => {
  it('préfère TAStatsAPI.ini, sinon DefaultStatsAPI.ini, sinon rien', async () => {
    const dir = await fakeGame(join(root, 'g'))
    expect(await locateIni(dir)).toBeNull()
    expect(await readStatsApiIni(dir)).toEqual({ found: false })

    await writeFile(join(dir, 'TAGame', 'Config', 'DefaultStatsAPI.ini'), INI)
    expect(await locateIni(dir)).toMatch(/DefaultStatsAPI\.ini$/)
    await writeFile(join(dir, 'TAGame', 'Config', 'TAStatsAPI.ini'), INI)
    expect(await locateIni(dir)).toMatch(/TAStatsAPI\.ini$/)
  })

  it('lit l’état : API désactivée à 0, sans sauvegarde au départ', async () => {
    const dir = await fakeGame(join(root, 'g'), { name: 'TAStatsAPI.ini', text: INI })
    expect(await readStatsApiIni(dir)).toMatchObject({
      found: true,
      enabled: false,
      hasBackup: false,
      settings: { packetSendRate: 0, port: 49123, webPort: 49124 }
    })
  })

  it('écrit en sauvegardant l’original UNE seule fois, puis le restaure', async () => {
    const dir = await fakeGame(join(root, 'g'), { name: 'TAStatsAPI.ini', text: INI })
    const ini = join(dir, 'TAGame', 'Config', 'TAStatsAPI.ini')

    expect(await writeStatsApiIni(dir, { packetSendRate: 30 })).toMatchObject({
      enabled: true,
      hasBackup: true
    })
    await writeStatsApiIni(dir, { packetSendRate: 60 })

    expect(await readFile(ini, 'utf8')).toContain('PacketSendRate=60')
    expect(await readFile(ini + '.rlstudio.bak', 'utf8')).toBe(INI)

    expect(await restoreStatsApiIni(dir)).toMatchObject({ enabled: false })
    expect(await readFile(ini, 'utf8')).toBe(INI)
  })

  it('refuse d’écrire sans fichier, et de restaurer sans sauvegarde', async () => {
    const dir = await fakeGame(join(root, 'g'))
    await expect(writeStatsApiIni(dir, { packetSendRate: 30 })).rejects.toThrow(/introuvable/)
    await writeFile(join(dir, 'TAGame', 'Config', 'TAStatsAPI.ini'), INI)
    await expect(restoreStatsApiIni(dir)).rejects.toThrow(/sauvegarde/)
  })
})
