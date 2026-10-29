import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ID_PATTERN,
  parseManifest,
  type InvalidPack,
  type LoadedPack,
  type PackScan
} from '@core/index'
import { resolveInside } from '@server/safePath'

const MANIFEST_FILE = 'manifest.json'
/** Un manifeste de plus de 1 Mo n'est pas un manifeste : on ne le charge pas en mémoire. */
const MAX_MANIFEST_BYTES = 1024 * 1024

type Loaded = { ok: true; pack: LoadedPack } | { ok: false; invalid: InvalidPack }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Scanne les dossiers de packs : chaque sous-dossier est un pack, son identifiant est le nom du
 * dossier. Un pack invalide n'est pas chargé mais reste listé avec ses erreurs (le client les
 * affiche) ; un pack cassé n'empêche jamais les autres de se charger.
 *
 * Plusieurs dossiers, du moins prioritaire au plus prioritaire : les packs fournis avec
 * l'application (remplacés à chaque mise à jour) puis ceux de l'utilisateur (jamais touchés par
 * l'installeur). À identifiant égal, le dernier dossier l'emporte : copier un pack fourni chez
 * l'utilisateur permet de le modifier.
 *
 * Pas d'Electron ici : les dossiers sont fournis par l'appelant (dev : racine du projet ;
 * installé : `process.resourcesPath/overlays` et le dossier des données de l'utilisateur).
 */
export class PackLoader {
  private current: PackScan = { packs: [], invalid: [] }
  private readonly byId = new Map<string, LoadedPack>()

  readonly dirs: readonly string[]

  constructor(dirs: string | readonly string[]) {
    this.dirs = typeof dirs === 'string' ? [dirs] : dirs
  }

  /** Résultat du dernier `scan()`. */
  get result(): PackScan {
    return this.current
  }

  /** Pack chargé et valide, `undefined` s'il n'existe pas ou s'il est invalide. */
  getPack(id: string): LoadedPack | undefined {
    return this.byId.get(id)
  }

  /** Relit les dossiers. Ne lève pas d'exception : un dossier absent donne un résultat vide. */
  async scan(): Promise<PackScan> {
    const byName = new Map<string, Loaded>()
    for (const root of this.dirs) {
      for (const name of await this.listPackNames(root)) {
        const loaded = await this.loadPack(root, name)
        const replaced = byName.get(name)
        if (replaced && loaded.ok) {
          loaded.pack.warnings.push(
            `remplace le pack du même nom de ${replaced.ok ? replaced.pack.dir : replaced.invalid.dir}`
          )
        }
        byName.set(name, loaded)
      }
    }

    const packs: LoadedPack[] = []
    const invalid: InvalidPack[] = []
    for (const name of [...byName.keys()].sort()) {
      const loaded = byName.get(name)!
      if (loaded.ok) packs.push(loaded.pack)
      else invalid.push(loaded.invalid)
    }

    this.current = { packs, invalid }
    this.byId.clear()
    for (const pack of packs) this.byId.set(pack.id, pack)
    return this.current
  }

  private async listPackNames(root: string): Promise<string[]> {
    try {
      const entries = await readdir(root, { withFileTypes: true })
      return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`PackLoader : impossible de lire ${root}`, error)
      }
      return []
    }
  }

  private async loadPack(root: string, id: string): Promise<Loaded> {
    const dir = join(root, id)
    const fail = (...errors: string[]): Loaded => ({ ok: false, invalid: { id, dir, errors } })

    if (!ID_PATTERN.test(id)) {
      return fail(
        'nom de dossier invalide : seuls a-z, 0-9 et - sont autorisés (renomme le dossier, ' +
          'son nom est l’identifiant du pack)'
      )
    }

    // manifest.json : présence, taille, lecture, JSON
    const manifestPath = join(dir, MANIFEST_FILE)
    let text: string
    try {
      const info = await stat(manifestPath)
      if (!info.isFile()) return fail(`${MANIFEST_FILE} n’est pas un fichier`)
      if (info.size > MAX_MANIFEST_BYTES) return fail(`${MANIFEST_FILE} trop volumineux (> 1 Mo)`)
      text = await readFile(manifestPath, 'utf8')
    } catch (error) {
      return fail(
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? `${MANIFEST_FILE} introuvable`
          : `${MANIFEST_FILE} illisible : ${errorMessage(error)}`
      )
    }

    let raw: unknown
    try {
      // Beaucoup d'éditeurs Windows enregistrent en UTF-8 AVEC BOM, que JSON.parse refuse.
      raw = JSON.parse(text.replace(/^\uFEFF/, ''))
    } catch (error) {
      return fail(`${MANIFEST_FILE} illisible : ${errorMessage(error)}`)
    }

    const parsed = parseManifest(raw)
    if (!parsed.ok) return fail(...parsed.errors)
    const { manifest } = parsed
    const warnings = [...parsed.warnings]

    // Les fichiers désignés doivent exister, être des fichiers, et rester dans le pack.
    const errors: string[] = []
    for (const [i, module] of manifest.modules.entries()) {
      const entry = await resolveInside(dir, module.entry)
      if (!entry?.isFile) {
        errors.push(`modules[${i}].entry : fichier introuvable dans le pack (${module.entry})`)
      }
    }
    if (errors.length > 0) return fail(...errors)

    if (manifest.preview !== undefined) {
      const preview = await resolveInside(dir, manifest.preview)
      if (!preview?.isFile) warnings.push(`preview : fichier introuvable (${manifest.preview})`)
    }

    return { ok: true, pack: { id, dir, manifest, warnings } }
  }
}
