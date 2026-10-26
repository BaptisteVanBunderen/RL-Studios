import { createContext, useContext } from 'react'
import type { AppState } from '@core/index'

/** Écran affiché. La navigation est un simple état : pas besoin d'un routeur pour 4 écrans. */
export type View =
  | { name: 'library' }
  | { name: 'pack'; packId: string }
  | { name: 'module'; key: string }
  | { name: 'settings' }

interface AppContextValue {
  state: AppState
  go: (view: View) => void
  /** Affiche une erreur à l'utilisateur (action refusée par le processus principal…). */
  report: (error: unknown) => void
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp doit être utilisé sous <AppContext.Provider>')
  return value
}

/**
 * Lance une action du processus principal ; en cas d'échec, l'erreur est montrée à l'utilisateur
 * (jamais avalée en silence).
 */
export function useAction(): (action: Promise<unknown>) => void {
  const { report } = useApp()
  return (action) => {
    action.catch(report)
  }
}
