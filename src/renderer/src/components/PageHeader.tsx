import type { ReactNode } from 'react'
import { ChevronLeftIcon } from './icons'
import { IconButton } from './ui'

/** En-tête commun : bouton retour facultatif, titre, sous-titre, actions à droite. */
export function PageHeader({
  title,
  subtitle,
  onBack,
  children
}: {
  title: string
  subtitle?: ReactNode
  onBack?: () => void
  children?: ReactNode
}): React.JSX.Element {
  return (
    <header className="flex items-center gap-4 border-b border-line px-8 py-5">
      {onBack && (
        <IconButton label="Retour" onClick={onBack}>
          <ChevronLeftIcon />
        </IconButton>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-3xl font-bold leading-tight">{title}</h1>
        {subtitle && <p className="truncate text-sm text-sub">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </header>
  )
}
