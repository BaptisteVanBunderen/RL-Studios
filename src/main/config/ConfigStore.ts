import { copyFileSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Emitter, defaultConfig, parseConfig, type AppConfig, type Unsubscribe } from '@core/index'

/**
 * Config de l'application, enregistrée dans un fichier JSON (en pratique
 * `<dossier utilisateur>/config.json`). Pas d'Electron ici : le chemin est fourni par l'appelant.
 *
 * - Un fichier absent ou illisible ne fait jamais planter : on repart des valeurs par défaut.
 * - Un fichier corrompu est d'abord copié en `.bak` pour que l'utilisateur puisse le récupérer.
 * - Les écritures sont atomiques (fichier temporaire puis renommage) et sérialisées : un arrêt
 *   brutal ne laisse jamais un fichier à moitié écrit, et deux sauvegardes ne se croisent pas.
 */
export class ConfigStore {
  private current: AppConfig = defaultConfig()
  private writing: Promise<void> = Promise.resolve()
  private readonly changes = new Emitter<AppConfig>()

  constructor(private readonly file: string) {}

  /** Configuration courante. À ne pas modifier directement : passer par `update()`. */
  get config(): Readonly<AppConfig> {
    return this.current
  }

  get path(): string {
    return this.file
  }

  /**
   * Lit le fichier (synchrone : c'est la première chose faite au démarrage).
   * `recovered` vaut `true` si le fichier existait mais n'a pas pu être lu.
   */
  load(): { recovered: boolean } {
    let text: string
    try {
      text = readFileSync(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`ConfigStore : lecture impossible de ${this.file}`, error)
      }
      this.current = defaultConfig()
      return { recovered: false }
    }

    try {
      // Beaucoup d'éditeurs Windows enregistrent en UTF-8 avec BOM, que JSON.parse refuse.
      this.current = parseConfig(JSON.parse(text.replace(/^\uFEFF/, '')))
      return { recovered: false }
    } catch (error) {
      console.error(`ConfigStore : ${this.file} illisible, valeurs par défaut utilisées`, error)
      try {
        copyFileSync(this.file, `${this.file}.bak`)
      } catch {
        // Pas de sauvegarde possible : on continue quand même.
      }
      this.current = defaultConfig()
      return { recovered: true }
    }
  }

  /**
   * Modifie la config puis l'enregistre. `change` reçoit une copie à modifier sur place (ou à
   * remplacer en renvoyant un nouvel objet). Résolu quand le fichier est écrit.
   */
  update(change: (config: AppConfig) => AppConfig | void): Promise<void> {
    const next = structuredClone(this.current)
    this.current = change(next) ?? next
    this.changes.emit(this.current)
    return this.save()
  }

  /** Prévient après chaque modification. */
  onChange(listener: (config: AppConfig) => void): Unsubscribe {
    return this.changes.on(listener)
  }

  /** Attend que toutes les écritures en cours soient terminées (à appeler avant de quitter). */
  flush(): Promise<void> {
    return this.writing
  }

  private save(): Promise<void> {
    const json = JSON.stringify(this.current, null, 2) + '\n'
    this.writing = this.writing.then(async () => {
      try {
        await mkdir(dirname(this.file), { recursive: true })
        const temp = `${this.file}.tmp`
        await writeFile(temp, json, 'utf8')
        await rename(temp, this.file)
      } catch (error) {
        // Une sauvegarde ratée ne doit ni planter l'appli ni bloquer les suivantes.
        console.error(`ConfigStore : écriture impossible de ${this.file}`, error)
      }
    })
    return this.writing
  }
}
