import type { ReactNode } from 'react'
import type { View } from '../appContext'
import { useAction, useApp } from '../appContext'
import { BookIcon, FolderIcon, GearIcon, GridIcon, LogoMark } from './icons'

function NavButton({
  active,
  label,
  onClick,
  children
}: {
  active: boolean
  label: string
  onClick: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border transition ${
        active
          ? 'border-line bg-card text-accent'
          : 'border-transparent text-sub hover:border-line hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

export function Sidebar({ view }: { view: View }): React.JSX.Element {
  const { go, tr } = useApp()
  const run = useAction()

  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-3 border-r border-line bg-side py-4">
      <LogoMark />
      <NavButton
        label="Overlays"
        active={view.name === 'library' || view.name === 'pack' || view.name === 'module'}
        onClick={() => go({ name: 'library' })}
      >
        <GridIcon />
      </NavButton>
      <NavButton
        label={tr('Réglages du jeu', 'Game settings')}
        active={view.name === 'settings'}
        onClick={() => go({ name: 'settings' })}
      >
        <GearIcon />
      </NavButton>
      <NavButton
        label={tr('Guide de création', 'Creation guide')}
        active={view.name === 'guide'}
        onClick={() => go({ name: 'guide' })}
      >
        <BookIcon />
      </NavButton>
      <NavButton
        label={tr('Ouvrir le dossier des overlays', 'Open the overlays folder')}
        active={false}
        onClick={() => run(window.rlstudio.openOverlaysFolder())}
      >
        <FolderIcon />
      </NavButton>
      <span className="mt-auto font-mono text-xs text-mute">1.0</span>
    </nav>
  )
}
