import { z } from 'zod'
import type { AppConfig } from './config'
import { IPC_EVENTS, IPC_INVOKE } from './ipcChannels'
import type { ManifestTopic, Position, SettingDefinition } from './manifest'
import { ID_PATTERN, positionSchema } from './manifest'
import { isModuleKey, moduleKey, type PackScan } from './packs'
import type { Rect } from './placement'
import type { ConnectionStatus } from './protocol'
import type { SessionState } from './session'
import { resolveSettings, type SettingValue } from './settings'

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
  /** Valeur effective de chaque réglage : celle de l'utilisateur si valide, sinon le défaut. */
  values: Record<string, SettingValue>
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

/** Écran sur lequel les overlays sont placés (écran principal pour l'instant). */
export interface DisplayInfo {
  /** Texte affiché, ex. « Principal — 2560 × 1440 ». */
  label: string
  /** Zone utilisable (hors barre des tâches), en pixels logiques. */
  workArea: Rect
}

export interface AppState {
  connection: ConnectionStatus
  session: SessionState
  packs: PacksSnapshot
  display: DisplayInfo
  /** Port WebSocket de l'API du jeu auquel l'application se connecte (127.0.0.1). */
  gamePort: number
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
          settings: module.settings,
          values: resolveSettings(module, config.modules[key]?.settings)
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
  [IPC_INVOKE.setPackEnabled]: { args: [packId: string, enabled: boolean]; result: PacksSnapshot }
  [IPC_INVOKE.setModulePlacement]: {
    args: [moduleKey: string, placement: ModulePlacementChange]
    result: PacksSnapshot
  }
  [IPC_INVOKE.adjustSession]: { args: [values: SessionAdjustment]; result: SessionState }
  [IPC_INVOKE.openOverlaysFolder]: { args: []; result: void }
  [IPC_INVOKE.setModuleSetting]: {
    args: [moduleKey: string, settingKey: string, value: SettingValue]
    result: PacksSnapshot
  }
}

/** `null` rétablit la valeur du manifeste (position) ou 1 (échelle) ; absent = inchangé. */
export interface ModulePlacementChange {
  position?: Position | null
  scale?: number | null
}

/** Valeurs de session corrigées à la main ; les absentes ne changent pas. */
export interface SessionAdjustment {
  wins?: number
  losses?: number
  streak?: number
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
  setPackEnabled(packId: string, enabled: boolean): Promise<PacksSnapshot>
  setModulePlacement(moduleKey: string, placement: ModulePlacementChange): Promise<PacksSnapshot>
  adjustSession(values: SessionAdjustment): Promise<SessionState>
  openOverlaysFolder(): Promise<void>
  setModuleSetting(
    moduleKey: string,
    settingKey: string,
    value: SettingValue
  ): Promise<PacksSnapshot>
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

export const setPackEnabledArgs = z.tuple([
  z.string().regex(ID_PATTERN, { error: 'identifiant de pack invalide' }),
  z.boolean()
])

export const setModulePlacementArgs = z.tuple([
  z.string().refine(isModuleKey, { error: 'clé de module invalide (attendu : pack/module)' }),
  z.strictObject({
    position: positionSchema.nullable().optional(),
    // les bornes de l'échelle sont vérifiées par Services.setModulePlacement
    scale: z.number().nullable().optional()
  })
])

export const adjustSessionArgs = z.tuple([
  z.strictObject({
    wins: z.number().optional(),
    losses: z.number().optional(),
    streak: z.number().optional()
  })
])

export const setModuleSettingArgs = z.tuple([
  z.string().refine(isModuleKey, { error: 'clé de module invalide (attendu : pack/module)' }),
  z.string().min(1).max(64),
  // la valeur est vérifiée contre la définition du manifeste par Services.setModuleSetting
  z.union([z.boolean(), z.number(), z.string().max(1000)])
])
