import { useEffect, useState } from 'react'
import type { AppState } from '@core/index'

/**
 * État de l'application côté client : un instantané au chargement, puis les notifications du
 * processus principal. `null` tant que le premier instantané n'est pas arrivé.
 */
export function useAppState(): { state: AppState | null; error: string | null } {
  const [state, setState] = useState<AppState | null>(null)
  // Valeur initiale calculée à la création : l'absence du preload n'est pas un changement d'état.
  const [error, setError] = useState<string | null>(() =>
    window.rlstudio ? null : "L'API du processus principal est indisponible (preload non chargé)."
  )

  useEffect(() => {
    const api = window.rlstudio
    if (!api) return

    let alive = true
    api
      .getState()
      .then((initial) => {
        if (alive) setState(initial)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })

    const unsubscribes = [
      api.onConnection((connection) => setState((s) => (s ? { ...s, connection } : s))),
      api.onSession((session) => setState((s) => (s ? { ...s, session } : s))),
      api.onPacks((packs) => setState((s) => (s ? { ...s, packs } : s)))
    ]
    return () => {
      alive = false
      for (const off of unsubscribes) off()
    }
  }, [])

  return { state, error }
}
