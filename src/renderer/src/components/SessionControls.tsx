import type { SessionState } from '@core/index'
import { useAction, useApp } from '../appContext'
import { formatStreak } from '../format'
import { Button, Panel, PanelTitle, Stepper } from './ui'

/** Barre « SESSION » permanente de la bibliothèque : compteurs réglables et remise à zéro. */
export function SessionBar(): React.JSX.Element {
  const { state, tr } = useApp()
  const run = useAction()
  const s = state.session

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-line bg-card px-5 py-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">
        {tr('Session', 'Session')}
      </span>

      <div className="flex items-center gap-3">
        <span className="text-sm text-sub">{tr('Victoires', 'Wins')}</span>
        <Stepper
          label={tr('Victoires', 'Wins')}
          value={s.wins}
          min={0}
          valueClassName="text-blue"
          onChange={(wins) => run(window.rlstudio.adjustSession({ wins }))}
        />
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-sub">{tr('Défaites', 'Losses')}</span>
        <Stepper
          label={tr('Défaites', 'Losses')}
          value={s.losses}
          min={0}
          onChange={(losses) => run(window.rlstudio.adjustSession({ losses }))}
        />
      </div>

      <div className="flex items-baseline gap-2 text-sm text-sub">
        {tr('Série', 'Streak')}
        <b className="text-lg font-semibold text-accent">{formatStreak(s.streak)}</b>
        <span className="font-mono text-xs text-mute">best {s.bestStreak}</span>
      </div>

      <Button className="ml-auto" onClick={() => run(window.rlstudio.resetSession())}>
        {tr('Réinitialiser', 'Reset')}
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
  const { state, tr } = useApp()
  const run = useAction()
  const s: SessionState = state.session

  return (
    <Panel>
      <PanelTitle aside={tr('commune à tous les overlays', 'shared by all overlays')}>
        {tr('Session en cours', 'Current session')}
      </PanelTitle>
      <div className="grid grid-cols-2 gap-3">
        <Cell label={tr('Victoires', 'Wins')}>
          <Stepper
            label={tr('Victoires', 'Wins')}
            value={s.wins}
            min={0}
            valueClassName="text-blue"
            onChange={(wins) => run(window.rlstudio.adjustSession({ wins }))}
          />
        </Cell>
        <Cell label={tr('Défaites', 'Losses')}>
          <Stepper
            label={tr('Défaites', 'Losses')}
            value={s.losses}
            min={0}
            onChange={(losses) => run(window.rlstudio.adjustSession({ losses }))}
          />
        </Cell>
        <Cell label={tr('Série', 'Streak')}>
          <Stepper
            label={tr('Série', 'Streak')}
            value={s.streak}
            valueClassName="text-accent"
            format={formatStreak}
            onChange={(streak) => run(window.rlstudio.adjustSession({ streak }))}
          />
        </Cell>
        <div className="flex items-center gap-3">
          <div className="flex flex-1 items-center justify-between rounded-xl border border-line bg-tile px-4 py-3">
            <span className="text-sm text-sub">{tr('Meilleure série', 'Best streak')}</span>
            <span className="font-mono text-lg font-semibold">{s.bestStreak}</span>
          </div>
          <Button onClick={() => run(window.rlstudio.resetSession())}>
            {tr('Réinitialiser', 'Reset')}
          </Button>
        </div>
      </div>
    </Panel>
  )
}

const STAT_LABELS: [keyof SessionState['stats'], string, string][] = [
  ['shots', 'Tirs', 'Shots'],
  ['goals', 'Buts', 'Goals'],
  ['assists', 'Passes décisives', 'Assists'],
  ['saves', 'Arrêts', 'Saves'],
  ['demos', 'Démolitions faites', 'Demolitions made'],
  ['demosTaken', 'Démolitions subies', 'Demolitions taken']
]

/** Totaux de statistiques de la session, pour les modules « stats » (lecture seule, en direct). */
export function StatsPanel(): React.JSX.Element {
  const { state, tr } = useApp()
  const run = useAction()
  const { stats } = state.session

  return (
    <Panel>
      <PanelTitle aside={tr('commune à tous les overlays', 'shared by all overlays')}>
        {tr('Statistiques de la session', 'Session statistics')}
      </PanelTitle>
      <div className="grid grid-cols-2 gap-3">
        {STAT_LABELS.map(([key, fr, en]) => (
          <Cell key={key} label={tr(fr, en)}>
            <b className="text-lg font-semibold tabular-nums">{stats[key]}</b>
          </Cell>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-sm text-mute">
          {tr(
            'Les totaux montent à chaque tir, but ou démolition. Les remettre à zéro réinitialise toute la session (victoires et défaites aussi).',
            'Totals go up with every shot, goal or demolition. Resetting them resets the whole session (wins and losses too).'
          )}
        </p>
        <Button className="shrink-0" onClick={() => run(window.rlstudio.resetSession())}>
          {tr('Réinitialiser', 'Reset')}
        </Button>
      </div>
    </Panel>
  )
}
