import type { ConnectionStatus } from '@core/index'
import { useApp } from '../appContext'

const LOOK: Record<ConnectionStatus, { label: string; pill: string; dot: string }> = {
  connected: {
    label: 'Connecté',
    pill: 'border-pill-line bg-pill text-pill-text',
    dot: 'bg-blue'
  },
  'game-closed': {
    label: 'Jeu fermé',
    pill: 'border-line bg-card text-sub',
    dot: 'bg-mute'
  },
  'api-disabled': {
    label: 'API inactive',
    pill: 'border-warn/30 bg-warn/10 text-warn',
    dot: 'bg-warn'
  }
}

/** Pastille d'état de la connexion au jeu ; mène à la page des réglages du jeu. */
export function ConnectionPill(): React.JSX.Element {
  const { state, go } = useApp()
  const look = LOOK[state.connection]

  return (
    <button
      type="button"
      onClick={() => go({ name: 'settings' })}
      title="Réglages du jeu"
      className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition hover:brightness-125 ${look.pill}`}
    >
      <span className={`h-2 w-2 rounded-full ${look.dot}`} />
      {look.label}
      {state.connection === 'connected' && (
        <span className="font-mono text-xs opacity-80">:{state.gamePort}</span>
      )}
    </button>
  )
}
