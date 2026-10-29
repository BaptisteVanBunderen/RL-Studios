import type { ReactNode } from 'react'
import { useApp } from '../appContext'
import { MinusIcon, PlusIcon } from './icons'

/** Interrupteur : orange allumé (pastille sombre à droite), gris éteint. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation() // un interrupteur posé dans une carte cliquable ne doit pas l'ouvrir
        onChange(!checked)
      }}
      className={`relative h-[26px] w-[46px] shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-accent' : 'bg-[#222a35]'
      }`}
    >
      <span
        className={`absolute top-[3px] h-5 w-5 rounded-full transition-all ${
          checked ? 'left-[23px] bg-bg' : 'left-[3px] bg-[#737c8b]'
        }`}
      />
    </button>
  )
}

/** Petite étiquette (« 2 modules », « 240 × 185 »). */
export function Chip({
  children,
  accent = false
}: {
  children: ReactNode
  accent?: boolean
}): React.JSX.Element {
  return (
    <span
      className={`rounded-md px-2 py-1 font-mono text-xs ${
        accent ? 'bg-accent/10 text-accent' : 'bg-tag text-sub'
      }`}
    >
      {children}
    </span>
  )
}

export function Panel({
  children,
  className = ''
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <section className={`rounded-2xl border border-line bg-card p-5 ${className}`}>
      {children}
    </section>
  )
}

export function PanelTitle({
  children,
  aside
}: {
  children: ReactNode
  aside?: ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">
        {children}
      </h2>
      {aside && <span className="font-mono text-xs text-mute">{aside}</span>}
    </div>
  )
}

type ButtonVariant = 'default' | 'primary'

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled = false,
  title,
  className = ''
}: {
  children: ReactNode
  onClick?: () => void
  variant?: ButtonVariant
  disabled?: boolean
  title?: string
  className?: string
}): React.JSX.Element {
  const look =
    variant === 'primary'
      ? 'border-accent bg-accent font-semibold text-bg hover:brightness-110'
      : 'border-line bg-card text-text hover:border-line-hover'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${look} ${className}`}
    >
      {children}
    </button>
  )
}

/** Bouton carré portant une icône (retour, actualiser…). */
export function IconButton({
  children,
  onClick,
  label
}: {
  children: ReactNode
  onClick: () => void
  label: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-line bg-card text-text transition hover:border-line-hover"
    >
      {children}
    </button>
  )
}

/** Compteur « − valeur + ». */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
  valueClassName = 'text-text',
  label
}: {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  step?: number
  format?: (value: number) => string
  valueClassName?: string
  label: string
}): React.JSX.Element {
  const { tr } = useApp()
  const clamp = (n: number): number =>
    Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.round(n * 1e6) / 1e6))
  const button =
    'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-line bg-field text-text transition hover:border-line-hover disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={button}
        aria-label={`${label} : ${tr('diminuer', 'decrease')}`}
        disabled={min !== undefined && value <= min}
        onClick={() => onChange(clamp(value - step))}
      >
        <MinusIcon size={14} />
      </button>
      <span className={`min-w-8 text-center text-lg font-semibold tabular-nums ${valueClassName}`}>
        {format ? format(value) : value}
      </span>
      <button
        type="button"
        className={button}
        aria-label={`${label} : ${tr('augmenter', 'increase')}`}
        disabled={max !== undefined && value >= max}
        onClick={() => onChange(clamp(value + step))}
      >
        <PlusIcon size={14} />
      </button>
    </div>
  )
}
