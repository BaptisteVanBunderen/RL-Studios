import type { SessionState } from '@core/index'
import { useAction, useApp } from '../appContext'
import { formatStreak } from '../format'
import { Button, Panel, PanelTitle, Stepper } from './ui'

/** Barre « SESSION » permanente de la bibliothèque : compteurs réglables et remise à zéro. */
export function SessionBar(): React.JSX.Element {
  const { state } = useApp()
  const run = useAction()
  const s = state.session

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-line bg-card px-5 py-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">
        Session
      </span>

      <div className="flex items-center gap-3">
        <span className="text-sm text-sub">Victoires</span>
        <Stepper
          label="Victoires"
          value={s.wins}
          min={0}
          valueClassName="text-blue"
          onChange={(wins) => run(window.rlstudio.adjustSession({ wins }))}
        />
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-sub">Défaites</span>
        <Stepper
          label="Défaites"
          value={s.losses}
          min={0}
          onChange={(losses) => run(window.rlstudio.adjustSession({ losses }))}
        />
      </div>

      <div className="flex items-baseline gap-2 text-sm text-sub">
        Série
        <b className="text-lg font-semibold text-accent">{formatStreak(s.streak)}</b>
        <span className="font-mono text-xs text-mute">best {s.bestStreak}</span>
      </div>

      <Button className="ml-auto" onClick={() => run(window.rlstudio.resetSession())}>
        Réinitialiser
      </Button>
    </div>
  )
}

function Cell({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-tile px-4 py-3">
      <span className="text-sm text-sub">{label}</span>
      {children}
    </div>
  )
}

/** Version en panneau, pour la page d'un module : mêmes compteurs, avec la série réglable. */
export function SessionPanel(): React.JSX.Element {
  const { state } = useApp()
  const run = useAction()
  const s: SessionState = state.session

  return (
    <Panel>
      <PanelTitle aside="commune à tous les overlays">Session en cours</PanelTitle>
      <div className="grid grid-cols-2 gap-3">
        <Cell label="Victoires">
          <Stepper
            label="Victoires"
            value={s.wins}
            min={0}
            valueClassName="text-blue"
            onChange={(wins) => run(window.rlstudio.adjustSession({ wins }))}
          />
        </Cell>
        <Cell label="Défaites">
          <Stepper
            label="Défaites"
            value={s.losses}
            min={0}
            onChange={(losses) => run(window.rlstudio.adjustSession({ losses }))}
          />
        </Cell>
        <Cell label="Série">
          <Stepper
            label="Série"
            value={s.streak}
            valueClassName="text-accent"
            format={formatStreak}
            onChange={(streak) => run(window.rlstudio.adjustSession({ streak }))}
          />
        </Cell>
        <div className="flex items-center gap-3">
          <div className="flex flex-1 items-center justify-between rounded-xl border border-line bg-tile px-4 py-3">
            <span className="text-sm text-sub">Meilleure série</span>
            <span className="font-mono text-lg font-semibold">{s.bestStreak}</span>
          </div>
          <Button onClick={() => run(window.rlstudio.resetSession())}>Réinitialiser</Button>
        </div>
      </div>
    </Panel>
  )
}
