import { useCallback, useEffect, useState } from 'react'
import { LANGUAGES, type ConnectionStatus, type GameSetupInfo, type Language } from '@core/index'
import { MAX_PACKET_SEND_RATE } from '@core/index'
import { useAction, useApp } from '../appContext'
import { CheckIcon, InfoIcon, WarningIcon } from '../components/icons'
import { OverlayDisplayPanel } from '../components/OverlayDisplayPanel'
import { PageHeader } from '../components/PageHeader'
import { Button, Panel, PanelTitle, Toggle } from '../components/ui'

interface StatusText {
  title: [fr: string, en: string]
  hint: [fr: string, en: string]
  tone: string
}

const STATUS: Record<ConnectionStatus, StatusText> = {
  connected: {
    title: ['Connecté au jeu', 'Connected to the game'],
    hint: ['', ''],
    tone: 'border-pill-line bg-pill text-pill-text'
  },
  'game-closed': {
    title: ['Jeu fermé', 'Game closed'],
    hint: ['En attente de Rocket League', 'Waiting for Rocket League'],
    tone: 'border-line bg-card text-sub'
  },
  'api-disabled': {
    title: ['Jeu lancé, API inactive', 'Game running, API inactive'],
    hint: [
      "Active l'API ci-dessous puis relance le jeu (ou attends la fin du chargement)",
      'Enable the API below then restart the game (or wait for it to finish loading)'
    ],
    tone: 'border-warn/30 bg-warn/10 text-warn'
  }
}

const LANGUAGE_NAMES: Record<Language, string> = { fr: 'Français', en: 'English' }

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

/** Langue de l'interface : la liste est dans la langue de chacune, pour qu'on la retrouve toujours. */
function LanguagePanel(): React.JSX.Element {
  const { state, tr } = useApp()
  const run = useAction()

  return (
    <Panel>
      <PanelTitle>{tr('Langue', 'Language')}</PanelTitle>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-sub">
          {tr("Langue de l'interface de RL Studio.", 'Language of the RL Studio interface.')}
        </p>
        <div className="flex gap-2" role="radiogroup" aria-label={tr('Langue', 'Language')}>
          {LANGUAGES.map((language) => (
            <Button
              key={language}
              variant={state.language === language ? 'primary' : 'default'}
              onClick={() => run(window.rlstudio.setLanguage(language))}
            >
              {LANGUAGE_NAMES[language]}
            </Button>
          ))}
        </div>
      </div>
    </Panel>
  )
}

export function GameSettings(): React.JSX.Element {
  const { state, go, report, tr } = useApp()
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
  const statusHint = tr(...status.hint)
  const hint =
    state.connection === 'connected'
      ? `127.0.0.1:${state.gamePort}`
      : `${statusHint} · 127.0.0.1:${state.gamePort}`

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
        tr(
          'Rocket League va être fermé puis relancé. Si tu es en match, il sera quitté. Continuer ?',
          'Rocket League will be closed then restarted. If you are in a match, you will leave it. Continue?'
        )
      )
    if (ok)
      act(
        window.rlstudio.restartGame().then(() => null),
        refresh
      )
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={tr('Réglages du jeu', 'Game settings')}
        subtitle={tr(
          "Connexion à l'API Stats de Rocket League",
          'Connection to the Rocket League Stats API'
        )}
      >
        <Button onClick={() => go({ name: 'library' })}>{tr('Retour', 'Back')}</Button>
      </PageHeader>

      <div className="flex-1 space-y-5 overflow-y-auto px-8 py-6">
        <div className={`flex items-center gap-4 rounded-2xl border p-5 ${status.tone}`}>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5">
            {state.connection === 'connected' ? <CheckIcon /> : <InfoIcon />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xl font-semibold">{tr(...status.title)}</p>
            <p className="font-mono text-sm opacity-80">{hint}</p>
          </div>
          <Button
            onClick={restart}
            disabled={busy || !setup?.install}
            title={
              setup?.install
                ? undefined
                : tr('Choisis d’abord le dossier du jeu', 'Choose the game folder first')
            }
          >
            {running
              ? tr('Relancer le jeu', 'Restart the game')
              : tr('Lancer le jeu', 'Launch the game')}
          </Button>
        </div>

        <LanguagePanel />

        <Panel>
          <PanelTitle>
            {tr('Installation de Rocket League', 'Rocket League installation')}
          </PanelTitle>
          {setup?.install ? (
            <>
              <Row label={tr('Dossier', 'Folder')}>{setup.install.dir}</Row>
              <Row label={tr('Boutique', 'Store')}>
                {setup.install.launcher === 'steam'
                  ? 'Steam'
                  : setup.install.launcher === 'epic'
                    ? 'Epic Games'
                    : tr('Inconnue', 'Unknown')}
              </Row>
            </>
          ) : (
            <p className="text-sm text-warn">
              {tr(
                'Installation introuvable. Choisis le dossier qui contient « TAGame » et « Binaries ».',
                'Installation not found. Choose the folder that contains "TAGame" and "Binaries".'
              )}
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
              {tr('Détecter', 'Detect')}
            </Button>
            <Button disabled={busy} onClick={() => act(window.rlstudio.pickGameDir())}>
              {tr('Choisir un dossier…', 'Choose a folder…')}
            </Button>
          </div>
        </Panel>

        <Panel>
          <PanelTitle aside={ini?.found ? ini.path : undefined}>
            {tr('API Stats', 'Stats API')}
          </PanelTitle>
          {!setup?.install ? (
            <p className="text-sm text-sub">
              {tr(
                "Disponible dès que l'installation est trouvée.",
                'Available as soon as the installation is found.'
              )}
            </p>
          ) : !ini?.found ? (
            <p className="text-sm text-warn">
              {tr(
                "Fichier de configuration de l'API introuvable dans TAGame\\Config. Lance le jeu une fois, puis réessaie.",
                'API configuration file not found in TAGame\\Config. Launch the game once, then try again.'
              )}
            </p>
          ) : (
            <>
              <Row label={tr('État', 'Status')}>
                {ini.enabled
                  ? tr(
                      `Activée · ${ini.settings.packetSendRate} paquets/s`,
                      `Enabled · ${ini.settings.packetSendRate} packets/s`
                    )
                  : tr('Désactivée', 'Disabled')}
              </Row>
              <Row label="Ports">
                TCP {ini.settings.port ?? '?'} · WebSocket {ini.settings.webPort ?? '?'}
              </Row>
              {ini.settings.webPort !== null && ini.settings.webPort !== state.gamePort && (
                <p className="mt-1 text-sm text-warn">
                  {tr(
                    `Le jeu écoute sur le port ${ini.settings.webPort} mais RL Studio se connecte au port ${state.gamePort} : modifie « gameWebPort » dans la configuration.`,
                    `The game listens on port ${ini.settings.webPort} but RL Studio connects to port ${state.gamePort}: change "gameWebPort" in the configuration.`
                  )}
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-sub">
                  {tr('Paquets par seconde', 'Packets per second')}
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
                  {ini.enabled ? tr('Appliquer', 'Apply') : tr('Activer l’API', 'Enable the API')}
                </Button>
                {ini.enabled && (
                  <Button disabled={busy} onClick={() => act(window.rlstudio.configureStatsApi(0))}>
                    {tr('Désactiver', 'Disable')}
                  </Button>
                )}
                {ini.hasBackup && (
                  <Button disabled={busy} onClick={() => act(window.rlstudio.restoreStatsApi())}>
                    {tr("Restaurer l'original", 'Restore the original')}
                  </Button>
                )}
              </div>
              <p className="mt-3 text-sm text-mute">
                {tr(
                  "Le fichier d'origine est sauvegardé une fois (extension .rlstudio.bak). Toute modification n'est prise en compte qu'après un redémarrage du jeu.",
                  'The original file is backed up once (.rlstudio.bak extension). Any change only takes effect after the game restarts.'
                )}
              </p>
            </>
          )}
        </Panel>

        <OverlayDisplayPanel />

        <Panel>
          <PanelTitle>{tr('Commandes', 'Commands')}</PanelTitle>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm">{tr('Masquer le HUD du jeu', 'Hide the game HUD')}</p>
              <p className="text-sm text-mute">
                {tr(
                  "Utile quand un overlay remplace l'affichage natif. Nécessite d'être connecté au jeu.",
                  'Useful when an overlay replaces the native display. Requires being connected to the game.'
                )}
              </p>
            </div>
            <Toggle
              label={tr('Masquer le HUD du jeu', 'Hide the game HUD')}
              checked={hudHidden}
              disabled={state.connection !== 'connected'}
              onChange={(hidden) =>
                act(window.rlstudio.setGameHud(!hidden), () => setHudHidden(hidden))
              }
            />
          </div>
        </Panel>

        <Panel>
          <PanelTitle>{tr("Serveur d'overlays", 'Overlay server')}</PanelTitle>
          <p className="text-sm text-sub">
            {tr(
              'Les overlays (dans le jeu comme dans OBS) lisent leurs données à cette adresse. Elle ne fonctionne que sur cet ordinateur.',
              'Overlays (in the game as well as in OBS) read their data at this address. It only works on this computer.'
            )}
          </p>
          <p className="mt-3 rounded-xl border border-line bg-field px-3 py-2 font-mono text-sm">
            {state.overlayBaseUrl}
          </p>
          <div className="mt-2">
            <Row label={tr('Overlays connectés', 'Connected overlays')}>
              {setup?.overlayClients ?? '—'}
            </Row>
            <Row label={tr('Données du jeu', 'Game data')}>
              {state.connection === 'connected'
                ? tr(
                    `${setup?.packetsPerSecond ?? 0} paquets/s`,
                    `${setup?.packetsPerSecond ?? 0} packets/s`
                  )
                : '—'}
            </Row>
          </div>
        </Panel>
      </div>

      <div className="px-8 pb-6">
        <div className="flex items-center gap-3 rounded-2xl border border-warn/30 bg-warn/10 px-5 py-3 text-sm text-warn">
          <WarningIcon size={18} className="shrink-0" />
          {tr(
            "Le jeu doit tourner en fenêtré sans bordure : en plein écran exclusif, aucun overlay ne s'affiche.",
            'The game must run in borderless windowed mode: in exclusive fullscreen, no overlay is shown.'
          )}
        </div>
      </div>
    </div>
  )
}
