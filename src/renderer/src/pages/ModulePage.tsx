import { useEffect, useRef, useState } from 'react'
import {
  MAX_SCALE,
  MIN_SCALE,
  offsetFromPosition,
  placeInArea,
  scaledSize,
  type ModuleSummary
} from '@core/index'
import { useAction, useApp } from '../appContext'
import { MoveIcon } from '../components/icons'
import { ObsPanel } from '../components/ObsPanel'
import { LivePreview } from '../components/LivePreview'
import { PageHeader } from '../components/PageHeader'
import { SettingField } from '../components/SettingFields'
import { SessionPanel, StatsPanel } from '../components/SessionControls'
import { Button, Panel, PanelTitle, Toggle } from '../components/ui'

/** Champ numérique (X, Y) : on tape librement, la valeur part à la sortie du champ ou sur Entrée. */
function CoordinateInput({
  label,
  value,
  onCommit
}: {
  label: string
  value: number
  onCommit: (value: number) => void
}): React.JSX.Element {
  const [text, setText] = useState(String(value))
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setText(String(value))
  }

  const commit = (): void => {
    const n = Number(text)
    if (text.trim() !== '' && Number.isFinite(n) && Math.round(n) !== value) onCommit(Math.round(n))
    else setText(String(value)) // saisie invalide ou inchangée : on revient à la valeur réelle
  }

  return (
    <label className="block">
      <span className="mb-1 block text-sm text-sub">{label}</span>
      <input
        type="number"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="w-full rounded-xl border border-line bg-field px-3 py-2 font-mono text-sm outline-none focus:border-accent"
      />
    </label>
  )
}

function PositionPanel({ module }: { module: ModuleSummary }): React.JSX.Element {
  const { state, tr } = useApp()
  const run = useAction()
  const { display } = state

  // Le curseur d'échelle suit la main ; l'enregistrement part peu après le dernier geste.
  const [scaleDraft, setScaleDraft] = useState(module.scale)
  const [seenScale, setSeenScale] = useState(module.scale)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  if (module.scale !== seenScale) {
    setSeenScale(module.scale)
    setScaleDraft(module.scale)
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  const changeScale = (scale: number): void => {
    setScaleDraft(scale)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(
      () => run(window.rlstudio.setModulePlacement(module.key, { scale })),
      150
    )
  }

  // X et Y affichés = position réelle de la fenêtre à l'écran. En interne on garde ancre + décalage
  // (indépendant de la résolution) : modifier X ou Y recalcule le décalage depuis la même ancre.
  const size = scaledSize(module.size, scaleDraft)
  const rect = placeInArea(module.position, scaledSize(module.size, module.scale), display.workArea)

  const move = (x: number, y: number): void => {
    const position = offsetFromPosition(module.position.anchor, { x, y }, size, display.workArea)
    run(window.rlstudio.setModulePlacement(module.key, { position }))
  }

  const isCustom =
    module.scale !== 1 ||
    module.position.anchor !== module.defaultPosition.anchor ||
    module.position.x !== module.defaultPosition.x ||
    module.position.y !== module.defaultPosition.y

  return (
    <Panel>
      <PanelTitle>{tr('Position et taille', 'Position and size')}</PanelTitle>

      <div className="grid grid-cols-2 gap-3">
        <CoordinateInput label="X" value={rect.x} onCommit={(x) => move(x, rect.y)} />
        <CoordinateInput label="Y" value={rect.y} onCommit={(y) => move(rect.x, y)} />
      </div>

      <div className="mt-4">
        <span className="mb-1 block text-sm text-sub">{tr('Écran', 'Display')}</span>
        <div className="rounded-xl border border-line bg-field px-3 py-2 text-sm">
          {display.label}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-sm text-sub">{tr('Échelle', 'Scale')}</span>
          <span className="font-mono text-sm text-accent">{Math.round(scaleDraft * 100)} %</span>
        </div>
        <input
          type="range"
          min={MIN_SCALE * 100}
          max={MAX_SCALE * 100}
          step={5}
          value={Math.round(scaleDraft * 100)}
          onChange={(e) => changeScale(Number(e.target.value) / 100)}
          aria-label={tr('Échelle', 'Scale')}
          className="h-2 w-full cursor-pointer"
        />
        <p className="mt-1 font-mono text-xs text-mute">
          {size.width} × {size.height} {tr("px à l'écran", 'px on screen')}
        </p>
      </div>

      <div className="mt-4 flex gap-2">
        <Button
          className="flex-1"
          disabled={!module.enabled}
          title={
            module.enabled
              ? undefined
              : tr('Active le module pour le placer', 'Enable the module to place it')
          }
          onClick={() => run(window.rlstudio.startEditMode())}
        >
          <MoveIcon size={16} /> {tr('Placer à la souris', 'Place with the mouse')}
        </Button>
        <Button
          disabled={!isCustom}
          title={tr(
            'Revenir à la position et à la taille prévues par le pack',
            'Go back to the position and size set by the pack'
          )}
          onClick={() =>
            run(window.rlstudio.setModulePlacement(module.key, { position: null, scale: null }))
          }
        >
          {tr('Rétablir', 'Reset')}
        </Button>
      </div>
    </Panel>
  )
}

function SettingsPanel({ module }: { module: ModuleSummary }): React.JSX.Element {
  const { tr } = useApp()
  const run = useAction()
  const n = module.settings.length

  return (
    <Panel>
      <PanelTitle
        aside={tr(
          `${n} champ${n > 1 ? 's' : ''} déclaré${n > 1 ? 's' : ''}`,
          `${n} declared field${n > 1 ? 's' : ''}`
        )}
      >
        {tr('Réglages du module', 'Module settings')}
      </PanelTitle>
      {n === 0 ? (
        <p className="text-sm text-sub">
          {tr('Ce module ne déclare aucun réglage.', 'This module declares no settings.')}
        </p>
      ) : (
        <div className="space-y-5">
          {module.settings.map((def) => (
            <SettingField
              key={def.key}
              def={def}
              value={module.values[def.key] ?? def.default}
              onCommit={(value) =>
                run(window.rlstudio.setModuleSetting(module.key, def.key, value))
              }
            />
          ))}
        </div>
      )}
    </Panel>
  )
}

export function ModulePage({ moduleKey }: { moduleKey: string }): React.JSX.Element {
  const { state, go, tr } = useApp()
  const run = useAction()

  const pack = state.packs.packs.find((p) => moduleKey.startsWith(`${p.id}/`))
  const module = pack?.modules.find((m) => m.key === moduleKey)

  if (!pack || !module) {
    return (
      <div className="p-8">
        <p className="text-sub">
          {tr("Ce module n'existe plus.", 'This module no longer exists.')}
        </p>
        <Button className="mt-4" onClick={() => go({ name: 'library' })}>
          {tr('Retour aux overlays', 'Back to overlays')}
        </Button>
      </div>
    )
  }

  const panel = module.category ?? (module.data.includes('session') ? 'session' : null)

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={module.name}
        subtitle={
          <span className="font-mono">
            {module.key} · {module.size.width} × {module.size.height}
          </span>
        }
        onBack={() => go({ name: 'pack', packId: pack.id })}
      >
        <span className="text-sm text-sub">{tr('Module actif', 'Module enabled')}</span>
        <Toggle
          label={tr(`Afficher « ${module.name} » dans le jeu`, `Show "${module.name}" in the game`)}
          checked={module.enabled}
          onChange={(enabled) => run(window.rlstudio.setModuleEnabled(module.key, enabled))}
        />
      </PageHeader>

      <div className="grid flex-1 grid-cols-1 gap-5 overflow-y-auto px-8 py-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-5">
          <Panel>
            <PanelTitle>{tr('Aperçu en direct', 'Live preview')}</PanelTitle>
            <div className="flex min-h-64 items-center justify-center rounded-xl border border-line bg-tile p-4">
              <LivePreview
                src={`${state.overlayBaseUrl}/overlay/${module.key}`}
                width={module.size.width}
                height={module.size.height}
                scale={module.scale}
                fitWidth={520}
                fitHeight={320}
              />
            </div>
          </Panel>
          {panel === 'session' && <SessionPanel />}
          {panel === 'stats' && <StatsPanel />}
          <ObsPanel module={module} />
        </div>

        <div className="space-y-5">
          <PositionPanel module={module} />
          <SettingsPanel module={module} />
        </div>
      </div>
    </div>
  )
}
