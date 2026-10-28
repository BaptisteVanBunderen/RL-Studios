import { useCallback, useEffect, useState } from 'react'
import type { ConnectionStatus, GameSetupInfo } from '@core/index'
import { MAX_PACKET_SEND_RATE } from '@core/index'
import { useApp } from '../appContext'
import { CheckIcon, InfoIcon, WarningIcon } from '../components/icons'
import { OverlayDisplayPanel } from '../components/OverlayDisplayPanel'
import { PageHeader } from '../components/PageHeader'
import { Button, Panel, PanelTitle, Toggle } from '../components/ui'

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
    hint: "Active l'API ci-dessous puis relance le jeu (ou attends la fin du chargement)",
    tone: 'border-warn/30 bg-warn/10 text-warn'
  }
}

const DEFAULT_RATE = 30
/** Délai entre deux rafraîchissements de la page (processus, paquets par seconde…). */
const REFRESH_MS = 2500

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-sub">{label}</span>
      <span className="min-w-0 truncate text-right font-mono">{children}</span>
    </div>
  )
}

export function GameSettings(): React.JSX.Element {
  const { state, go, report } = useApp()
  const [setup, setSetup] = useState<GameSetupInfo | null>(null)
  const [rateDraft, setRateDraft] = useState<string | null>(null)
  const [hudHidden, setHudHidden] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    window.rlstudio
      .getGameSetup()
      .then(setSetup)
      .catch(() => undefined)
  }, [])

  // Le statut de connexion et le processus du jeu changent hors de la page : on relit régulièrement.
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh, state.connection])

  /** Lance une action du main qui renvoie l'état du jeu à jour ; les erreurs sont montrées. */
  const act = (action: Promise<GameSetupInfo | null | void>, after?: () => void): void => {
    setBusy(true)
    action
      .then((next) => {
        if (next) setSetup(next)
        after?.()
      })
      .catch(report)
      .finally(() => setBusy(false))
  }

  const status = STATUS[state.connection]
  const hint =
    state.connection === 'connected'
      ? `127.0.0.1:${state.gamePort}`
      : `${status.hint} · 127.0.0.1:${state.gamePort}`

  const ini = setup?.ini
  const currentRate = ini?.found ? ini.settings.packetSendRate : null
  const rateText = rateDraft ?? String(currentRate && currentRate > 0 ? currentRate : DEFAULT_RATE)
  const rate = Number(rateText)
  const rateValid =
    rateText.trim() !== '' && Number.isInteger(rate) && rate >= 1 && rate <= MAX_PACKET_SEND_RATE
  const running = setup?.processRunning ?? false

  const restart = (): void => {
    const ok =
      !running ||
      window.confirm(
        'Rocket League va être fermé puis relancé. Si tu es en match, il sera quitté. Continuer ?'
      )
    if (ok)
      act(
        window.rlstudio.restartGame().then(() => null),
        refresh
      )
  }

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
          <div className="min-w-0 flex-1">
            <p className="text-xl font-semibold">{status.title}</p>
            <p className="font-mono text-sm opacity-80">{hint}</p>
          </div>
          <Button
            onClick={restart}
            disabled={busy || !setup?.install}
            title={setup?.install ? undefined : 'Choisis d’abord le dossier du jeu'}
          >
            {running ? 'Relancer le jeu' : 'Lancer le jeu'}
          </Button>
        </div>

        <Panel>
          <PanelTitle>Installation de Rocket League</PanelTitle>
          {setup?.install ? (
            <>
              <Row label="Dossier">{setup.install.dir}</Row>
              <Row label="Boutique">
                {setup.install.launcher === 'steam'
                  ? 'Steam'
                  : setup.install.launcher === 'epic'
                    ? 'Epic Games'
                    : 'Inconnue'}
              </Row>
            </>
          ) : (
            <p className="text-sm text-warn">
              Installation introuvable. Choisis le dossier qui contient « TAGame » et « Binaries ».
            </p>
          )}
          {setup && setup.candidates.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {setup.candidates.map((c) => (
                <Button
                  key={c.dir}
                  disabled={busy || c.dir === setup.install?.dir}
                  onClick={() => act(window.rlstudio.setGameDir(c.dir))}
                >
                  {c.launcher === 'epic' ? 'Epic' : 'Steam'} — {c.dir}
                </Button>
              ))}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <Button disabled={busy} onClick={() => act(window.rlstudio.detectGame())}>
              Détecter
            </Button>
            <Button disabled={busy} onClick={() => act(window.rlstudio.pickGameDir())}>
              Choisir un dossier…
            </Button>
          </div>
        </Panel>

        <Panel>
          <PanelTitle aside={ini?.found ? ini.path : undefined}>API Stats</PanelTitle>
          {!setup?.install ? (
            <p className="text-sm text-sub">Disponible dès que l&apos;installation est trouvée.</p>
          ) : !ini?.found ? (
            <p className="text-sm text-warn">
              Fichier de configuration de l&apos;API introuvable dans TAGame\Config. Lance le jeu
              une fois, puis réessaie.
            </p>
          ) : (
            <>
              <Row label="État">
                {ini.enabled ? `Activée · ${ini.settings.packetSendRate} paquets/s` : 'Désactivée'}
              </Row>
              <Row label="Ports">
                TCP {ini.settings.port ?? '?'} · WebSocket {ini.settings.webPort ?? '?'}
              </Row>
              {ini.settings.webPort !== null && ini.settings.webPort !== state.gamePort && (
                <p className="mt-1 text-sm text-warn">
                  Le jeu écoute sur le port {ini.settings.webPort} mais RL Studio se connecte au
                  port {state.gamePort} : modifie « gameWebPort » dans la configuration.
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-sub">
                  Paquets par seconde
                  <input
                    type="number"
                    min={1}
                    max={MAX_PACKET_SEND_RATE}
                    value={rateText}
                    onChange={(e) => setRateDraft(e.target.value)}
                    className="w-20 rounded-lg border border-line bg-field px-2 py-1.5 font-mono text-text"
                  />
                </label>
                <Button
                  variant="primary"
                  disabled={busy || !rateValid}
                  onClick={() =>
                    act(window.rlstudio.configureStatsApi(rate), () => setRateDraft(null))
                  }
                >
                  {ini.enabled ? 'Appliquer' : 'Activer l’API'}
                </Button>
                {ini.enabled && (
                  <Button disabled={busy} onClick={() => act(window.rlstudio.configureStatsApi(0))}>
                    Désactiver
                  </Button>
                )}
                {ini.hasBackup && (
                  <Button disabled={busy} onClick={() => act(window.rlstudio.restoreStatsApi())}>
                    Restaurer l&apos;original
                  </Button>
                )}
              </div>
              <p className="mt-3 text-sm text-mute">
                Le fichier d&apos;origine est sauvegardé une fois (extension .rlstudio.bak). Toute
                modification n&apos;est prise en compte qu&apos;après un redémarrage du jeu.
              </p>
            </>
          )}
        </Panel>

        <OverlayDisplayPanel />

        <Panel>
          <PanelTitle>Commandes</PanelTitle>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm">Masquer le HUD du jeu</p>
              <p className="text-sm text-mute">
                Utile quand un overlay remplace l&apos;affichage natif. Nécessite d&apos;être
                connecté au jeu.
              </p>
            </div>
            <Toggle
              label="Masquer le HUD du jeu"
              checked={hudHidden}
              disabled={state.connection !== 'connected'}
              onChange={(hidden) =>
                act(window.rlstudio.setGameHud(!hidden), () => setHudHidden(hidden))
              }
            />
          </div>
        </Panel>

        <Panel>
          <PanelTitle>Serveur d&apos;overlays</PanelTitle>
          <p className="text-sm text-sub">
            Les overlays (dans le jeu comme dans OBS) lisent leurs données à cette adresse. Elle ne
            fonctionne que sur cet ordinateur.
          </p>
          <p className="mt-3 rounded-xl border border-line bg-field px-3 py-2 font-mono text-sm">
            {state.overlayBaseUrl}
          </p>
          <div className="mt-2">
            <Row label="Overlays connectés">{setup?.overlayClients ?? '—'}</Row>
            <Row label="Données du jeu">
              {state.connection === 'connected' ? `${setup?.packetsPerSecond ?? 0} paquets/s` : '—'}
            </Row>
          </div>
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
