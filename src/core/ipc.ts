import { z } from 'zod'
import type { AppConfig } from './config'
import { IPC_EVENTS, IPC_INVOKE } from './ipcChannels'
import type { ManifestTopic, Position, SettingDefinition } from './manifest'
import { isModuleKey, moduleKey, type PackScan } from './packs'
import type { ConnectionStatus } from './protocol'
import type { SessionState } from './session'

export { IPC_EVENTS, IPC_INVOKE }

/**
 * Types partagés entre le processus principal, le preload et le client React.
 * Tout ce qui traverse l'IPC doit être sérialisable (pas de chemins absolus, pas de classes).
 */

export interface ModuleSummary {
  /** `<pack>/<module>`. */
  key: string
  id: string
  name: string
  description: string
  enabled: boolean
  size: { width: number; height: number }
  /** Position effective : celle de l'utilisateur, sinon celle du manifeste. */
  position: Position
  /** Position du manifeste (pour « rétablir »). */
  defaultPosition: Position
  /** Échelle effective (1 = taille de référence). */
  scale: number
  data: ManifestTopic[]
  settings: SettingDefinition[]
}

export interface PackSummary {
  id: string
  name: string
  description: string
  author: string
  version: string
  /** Chemin de l'aperçu relatif au pack (servi à `/overlay/<pack>/<preview>`). */
  preview: string | null
  warnings: string[]
  modules: ModuleSummary[]
}

/** Dossier présent dans `overlays/` mais non chargé : affiché avec ses erreurs. */
export interface InvalidPackSummary {
  id: string
  errors: string[]
}

export interface PacksSnapshot {
  packs: PackSummary[]
  invalid: InvalidPackSummary[]
}

export interface AppState {
  connection: ConnectionStatus
  session: SessionState
  packs: PacksSnapshot
  /** `http://127.0.0.1:<port>` : base des URL d'overlay (« Copier l'URL OBS »). */
  overlayBaseUrl: string
}

/** Vue sérialisable des packs, avec l'état d'activation de chaque module. */
export function toPacksSnapshot(scan: PackScan, config: Pick<AppConfig, 'modules'>): PacksSnapshot {
  return {
    packs: scan.packs.map((pack) => ({
      id: pack.id,
      name: pack.manifest.name,
      description: pack.manifest.description,
      author: pack.manifest.author,
      version: pack.manifest.version,
      preview: pack.manifest.preview ?? null,
      warnings: pack.warnings,
      modules: pack.manifest.modules.map((module) => {
        const key = moduleKey(pack.id, module.id)
        return {
          key,
          id: module.id,
          name: module.name,
          description: module.description,
          enabled: config.modules[key]?.enabled === true,
          size: module.size,
          position: config.modules[key]?.position ?? module.defaultPosition,
          defaultPosition: module.defaultPosition,
          scale: config.modules[key]?.scale ?? 1,
          data: module.data,
          settings: module.settings
        }
      })
    })),
    invalid: scan.invalid.map((p) => ({ id: p.id, errors: p.errors }))
  }
}

/** Requêtes client → main : arguments et résultat de chaque canal. */
export interface InvokeMap {
  [IPC_INVOKE.getState]: { args: []; result: AppState }
  [IPC_INVOKE.reloadPacks]: { args: []; result: PacksSnapshot }
  [IPC_INVOKE.setModuleEnabled]: {
    args: [moduleKey: string, enabled: boolean]
    result: PacksSnapshot
  }
  [IPC_INVOKE.resetSession]: { args: []; result: SessionState }
}

/** Notifications main → client : contenu de chaque canal. */
export interface EventMap {
  [IPC_EVENTS.connection]: ConnectionStatus
  [IPC_EVENTS.session]: SessionState
  [IPC_EVENTS.packs]: PacksSnapshot
}

export type Unsubscribe = () => void

/** API exposée au client React par le preload (`window.rlstudio`). Seul accès du client au main. */
export interface RlStudioApi {
  getState(): Promise<AppState>
  reloadPacks(): Promise<PacksSnapshot>
  setModuleEnabled(moduleKey: string, enabled: boolean): Promise<PacksSnapshot>
  resetSession(): Promise<SessionState>
  onConnection(listener: (status: ConnectionStatus) => void): Unsubscribe
  onSession(listener: (session: SessionState) => void): Unsubscribe
  onPacks(listener: (packs: PacksSnapshot) => void): Unsubscribe
}

/**
 * Arguments de `modules:set-enabled`, revalidés côté main : le client est notre code, mais tout
 * ce qui franchit une frontière de processus est vérifié.
 */
export const setModuleEnabledArgs = z.tuple([
  z.string().refine(isModuleKey, { error: 'clé de module invalide (attendu : pack/module)' }),
  z.boolean()
])
