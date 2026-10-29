import { useCallback, useEffect, useState } from 'react'
import { detectLanguage, pick } from '@core/index'
import { AppContext, type View } from './appContext'
import { Sidebar } from './components/Sidebar'
import { GameSettings } from './pages/GameSettings'
import { Library } from './pages/Library'
import { ModulePage } from './pages/ModulePage'
import { PackPage } from './pages/PackPage'
import { useAppState } from './useAppState'

function errorMessage(error: unknown): string {
  // Electron préfixe les erreurs du processus principal : « Error invoking remote method '…': Error: … ».
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
}

function Toast({ message, onClose }: { message: string; onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    const timer = setTimeout(onClose, 6000)
    return () => clearTimeout(timer)
  }, [message, onClose])

  return (
    <div
      role="alert"
      onClick={onClose}
      className="fixed right-6 bottom-6 z-10 max-w-md cursor-pointer rounded-xl border border-danger/40 bg-card px-4 py-3 text-sm text-danger shadow-lg"
    >
      {message}
    </div>
  )
}

function App(): React.JSX.Element {
  const { state, error } = useAppState()
  const [view, setView] = useState<View>({ name: 'library' })
  const [toast, setToast] = useState<string | null>(null)

  const report = useCallback((e: unknown) => setToast(errorMessage(e)), [])
  const closeToast = useCallback(() => setToast(null), [])

  if (error) return <p className="p-8 text-danger">{error}</p>
  if (!state) {
    // la langue choisie n'est pas encore connue : celle du système
    const loading = pick(detectLanguage(navigator.language), 'Chargement…', 'Loading…')
    return <p className="p-8 text-sub">{loading}</p>
  }

  const tr = (fr: string, en: string): string => pick(state.language, fr, en)

  return (
    <AppContext.Provider value={{ state, go: setView, report, tr }}>
      <div className="flex h-full">
        <Sidebar view={view} />
        <main className="min-w-0 flex-1">
          {view.name === 'library' && <Library />}
          {view.name === 'pack' && <PackPage packId={view.packId} />}
          {view.name === 'module' && <ModulePage moduleKey={view.key} />}
          {view.name === 'settings' && <GameSettings />}
        </main>
      </div>
      {toast && <Toast message={toast} onClose={closeToast} />}
    </AppContext.Provider>
  )
}

export default App
