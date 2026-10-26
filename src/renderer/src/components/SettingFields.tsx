import { useEffect, useRef, useState } from 'react'
import type { SettingDefinition, SettingValue } from '@core/index'
import { MinusIcon, PlusIcon } from './icons'
import { Toggle } from './ui'

/** Couleurs proposées quand le manifeste n'en déclare pas. La valeur reste libre. */
const DEFAULT_PALETTE = ['#3B9CE0', '#E96F22', '#A78BFA', '#F1F4F9']

/** Délai avant d'enregistrer une valeur qu'on est en train de faire glisser ou de taper. */
const COMMIT_DELAY_MS = 150

type OnCommit = (value: SettingValue) => void

/**
 * Valeur locale pour les champs « continus » (curseur, texte, nombre) : l'interface suit la main
 * sans attendre le processus principal, et l'enregistrement part peu après le dernier geste.
 * La valeur du processus principal reprend la main dès qu'elle change.
 */
function useDraft<T extends SettingValue>(
  value: T,
  commit: (value: T) => void
): [T, (next: T) => void] {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // La valeur du processus principal reprend la main dès qu'elle change (ajustement pendant le
  // rendu, le motif que React recommande plutôt qu'un effet).
  if (value !== seen) {
    setSeen(value)
    setDraft(value)
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const update = (next: T): void => {
    setDraft(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => commit(next), COMMIT_DELAY_MS)
  }
  return [draft, update]
}

function Label({
  children,
  hint
}: {
  children: React.ReactNode
  hint?: string
}): React.JSX.Element {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <span className="text-sm text-text">{children}</span>
      {hint && <span className="font-mono text-xs text-mute">{hint}</span>}
    </div>
  )
}

function ColorField({
  def,
  value,
  onCommit
}: {
  def: Extract<SettingDefinition, { type: 'color' }>
  value: string
  onCommit: OnCommit
}): React.JSX.Element {
  const palette = def.palette ?? DEFAULT_PALETTE
  const [draft, setDraft] = useDraft(value, onCommit)
  const current = draft.toLowerCase()

  return (
    <div>
      <Label hint={draft.toUpperCase()}>{def.label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        {palette.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={color}
            title={color}
            onClick={() => onCommit(color)}
            className={`h-8 w-8 cursor-pointer rounded-lg border-2 transition ${
              current === color.toLowerCase()
                ? 'border-white'
                : 'border-transparent hover:border-line-hover'
            }`}
            style={{ background: color }}
          />
        ))}
        {/* valeur libre : le sélecteur natif ne gère que #rrggbb, ce qui suffit aux couleurs unies */}
        <label
          className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-dashed border-line-hover text-xs text-sub hover:text-text"
          title="Autre couleur"
        >
          +
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(draft) ? draft : '#000000'}
            onChange={(e) => setDraft(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label={`${def.label} : autre couleur`}
          />
        </label>
      </div>
    </div>
  )
}

function RangeField({
  def,
  value,
  onCommit
}: {
  def: Extract<SettingDefinition, { type: 'range' }>
  value: number
  onCommit: OnCommit
}): React.JSX.Element {
  const [draft, setDraft] = useDraft(value, onCommit)
  const percent = def.unit === '%' && def.max <= 1 // 0–1 affiché en pourcentage
  const shown = percent ? Math.round(draft * 100) : Math.round(draft * 100) / 100

  return (
    <div>
      <Label>{def.label}</Label>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={def.min}
          max={def.max}
          step={def.step ?? (def.max - def.min) / 100}
          value={draft}
          onChange={(e) => setDraft(Number(e.target.value))}
          className="h-2 min-w-0 flex-1 cursor-pointer"
          aria-label={def.label}
        />
        <span className="w-16 shrink-0 text-right font-mono text-sm text-accent">
          {shown}
          {def.unit ? ` ${def.unit}` : ''}
        </span>
      </div>
    </div>
  )
}

function NumberField({
  def,
  value,
  onCommit
}: {
  def: Extract<SettingDefinition, { type: 'number' }>
  value: number
  onCommit: OnCommit
}): React.JSX.Element {
  const [draft, setDraft] = useDraft(value, onCommit)
  const step = def.step ?? 1
  const clamp = (n: number): number =>
    Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, n))
  const round = (n: number): number => Math.round(n * 1e6) / 1e6
  const button =
    'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-line bg-field text-text transition hover:border-line-hover'

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-text">{def.label}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={button}
          aria-label={`${def.label} : diminuer`}
          onClick={() => setDraft(clamp(round(draft - step)))}
        >
          <MinusIcon size={14} />
        </button>
        <input
          type="number"
          value={draft}
          min={def.min}
          max={def.max}
          step={step}
          aria-label={def.label}
          onChange={(e) => {
            const n = e.target.valueAsNumber
            if (Number.isFinite(n)) setDraft(clamp(n))
          }}
          className="w-16 rounded-lg border border-line bg-field px-2 py-1 text-center font-mono text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          className={button}
          aria-label={`${def.label} : augmenter`}
          onClick={() => setDraft(clamp(round(draft + step)))}
        >
          <PlusIcon size={14} />
        </button>
        {def.unit && <span className="font-mono text-xs text-mute">{def.unit}</span>}
      </div>
    </div>
  )
}

function TextField({
  def,
  value,
  onCommit
}: {
  def: Extract<SettingDefinition, { type: 'text' }>
  value: string
  onCommit: OnCommit
}): React.JSX.Element {
  const [draft, setDraft] = useDraft(value, onCommit)

  return (
    <div>
      <Label hint={def.maxLength ? `${draft.length}/${def.maxLength}` : undefined}>
        {def.label}
      </Label>
      <input
        type="text"
        value={draft}
        maxLength={def.maxLength}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={def.label}
        className="w-full rounded-xl border border-line bg-field px-3 py-2 text-sm outline-none focus:border-accent"
      />
    </div>
  )
}

function EnumField({
  def,
  value,
  onCommit
}: {
  def: Extract<SettingDefinition, { type: 'enum' }>
  value: string
  onCommit: OnCommit
}): React.JSX.Element {
  // 2 à 4 choix : boutons exclusifs côte à côte ; au-delà, une liste déroulante.
  if (def.options.length > 4) {
    return (
      <div>
        <Label>{def.label}</Label>
        <select
          value={value}
          onChange={(e) => onCommit(e.target.value)}
          aria-label={def.label}
          className="w-full rounded-xl border border-line bg-field px-3 py-2 text-sm outline-none focus:border-accent"
        >
          {def.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <div>
      <Label>{def.label}</Label>
      <div
        role="radiogroup"
        aria-label={def.label}
        className="flex rounded-xl border border-line bg-field p-1"
      >
        {def.options.map((o) => {
          const active = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onCommit(o.value)}
              className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-sm transition ${
                active ? 'bg-accent font-semibold text-bg' : 'text-sub hover:text-text'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Le widget qui correspond au type déclaré dans le manifeste. */
export function SettingField({
  def,
  value,
  onCommit
}: {
  def: SettingDefinition
  value: SettingValue
  onCommit: OnCommit
}): React.JSX.Element {
  switch (def.type) {
    case 'boolean':
      return (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-text">{def.label}</span>
          <Toggle label={def.label} checked={value === true} onChange={onCommit} />
        </div>
      )
    case 'color':
      return <ColorField def={def} value={String(value)} onCommit={onCommit} />
    case 'range':
      return <RangeField def={def} value={Number(value)} onCommit={onCommit} />
    case 'number':
      return <NumberField def={def} value={Number(value)} onCommit={onCommit} />
    case 'text':
      return <TextField def={def} value={String(value)} onCommit={onCommit} />
    case 'enum':
      return <EnumField def={def} value={String(value)} onCommit={onCommit} />
  }
}
