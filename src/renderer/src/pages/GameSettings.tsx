import type { ConnectionStatus } from '@core/index'
import { useApp } from '../appContext'
import { CheckIcon, InfoIcon, WarningIcon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'
import { Button, Panel, PanelTitle } from '../components/ui'

const STATUS: Record<ConnectionStatus, { title: string; hint: string; tone: string }> = {
  connected: {
    title: 'Connecté au jeu',
    hint: '',
    tone: 'border-pill-line bg-pill text-pill-text'
  },
  'game-closed': {
    title: 'Jeu fermé',
    hint: 'En attente de Rocket League',
    tone: 'border-line bg-card text-sub'
  },
  'api-disabled': {
    title: 'Jeu lancé, API inactive',
    hint: 'Le fichier de configuration doit être appliqué',
    tone: 'border-warn/30 bg-warn/10 text-warn'
  }
}

export function GameSettings(): React.JSX.Element {
  const { state, go } = useApp()
  const status = STATUS[state.connection]
  const hint =
    state.connection === 'connected'
      ? `127.0.0.1:${state.gamePort}`
      : `${status.hint} · 127.0.0.1:${state.gamePort}`

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Réglages du jeu" subtitle="Connexion à l'API Stats de Rocket League">
        <Button onClick={() => go({ name: 'library' })}>Retour</Button>
      </PageHeader>

      <div className="flex-1 space-y-5 overflow-y-auto px-8 py-6">
        <div className={`flex items-center gap-4 rounded-2xl border p-5 ${status.tone}`}>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5">
            {state.connection === 'connected' ? <CheckIcon /> : <InfoIcon />}
          </div>
          <div>
            <p className="text-xl font-semibold">{status.title}</p>
            <p className="font-mono text-sm opacity-80">{hint}</p>
          </div>
        </div>

        <Panel>
          <PanelTitle>Serveur d&apos;overlays</PanelTitle>
          <p className="text-sm text-sub">
            Les overlays (dans le jeu comme dans OBS) lisent leurs données à cette adresse. Elle ne
            fonctionne que sur cet ordinateur.
          </p>
          <p className="mt-3 rounded-xl border border-line bg-field px-3 py-2 font-mono text-sm">
            {state.overlayBaseUrl}
          </p>
        </Panel>

        <Panel>
          <PanelTitle>À venir</PanelTitle>
          <p className="text-sm text-sub">
            Détection de l&apos;installation du jeu, réglage du port et du débit de l&apos;API (avec
            sauvegarde du fichier d&apos;origine), relance du jeu et raccourci global pour masquer
            les overlays.
          </p>
        </Panel>
      </div>

      <div className="px-8 pb-6">
        <div className="flex items-center gap-3 rounded-2xl border border-warn/30 bg-warn/10 px-5 py-3 text-sm text-warn">
          <WarningIcon size={18} className="shrink-0" />
          Le jeu doit tourner en fenêtré sans bordure : en plein écran exclusif, aucun overlay ne
          s&apos;affiche.
        </div>
      </div>
    </div>
  )
}
