import { useState } from 'react'
import { acceleratorFromKey } from '@core/index'
import { useAction, useApp } from '../appContext'
import { MoveIcon } from './icons'
import { Button, Panel, PanelTitle, Toggle } from './ui'

/** Où et quand s'affichent les overlays : écran, interrupteur, raccourci, placement à la souris. */
export function OverlayDisplayPanel(): React.JSX.Element {
  const { state } = useApp()
  const run = useAction()
  const [capturing, setCapturing] = useState(false)
  const { displays, display, overlays } = state

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    event.preventDefault()
    if (event.key === 'Escape') {
      setCapturing(false)
      return
    }
    const bare = !event.ctrlKey && !event.altKey && !event.shiftKey
    if (bare && (event.key === 'Backspace' || event.key === 'Delete')) {
      setCapturing(false)
      run(window.rlstudio.setShortcut(null))
      return
    }
    const accelerator = acceleratorFromKey(event.nativeEvent)
    if (!accelerator) return // modificateur seul, ou touche inutilisable : on attend la suite
    setCapturing(false)
    run(window.rlstudio.setShortcut(accelerator))
  }

  return (
    <Panel>
      <PanelTitle>Affichage des overlays</PanelTitle>

      <div className="flex items-center justify-between gap-4 py-2 text-sm">
        <span className="text-sub">Écran</span>
        <select
          value={display.id}
          onChange={(e) => {
            const id = Number(e.target.value)
            run(window.rlstudio.setDisplay(id === displays[0]?.id ? null : id))
          }}
          className="rounded-lg border border-line bg-field px-2 py-1.5 font-mono text-text"
        >
          {displays.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between gap-4 py-2 text-sm">
        <span className="text-sub">Afficher les overlays dans le jeu</span>
        <Toggle
          label="Afficher les overlays dans le jeu"
          checked={overlays.visible}
          onChange={(visible) => run(window.rlstudio.setOverlaysVisible(visible))}
        />
      </div>

      <div className="flex items-center justify-between gap-4 py-2 text-sm">
        <span className="text-sub">Raccourci pour les masquer / afficher</span>
        <input
          readOnly
          value={capturing ? 'Appuie sur le raccourci…' : (overlays.shortcut ?? 'Aucun')}
          onFocus={() => setCapturing(true)}
          onBlur={() => setCapturing(false)}
          onKeyDown={onKeyDown}
          title="Clique, puis appuie sur la combinaison. Retour arrière : supprimer. Échap : annuler."
          aria-label="Raccourci global"
          className={`w-52 cursor-pointer rounded-lg border bg-field px-3 py-1.5 text-center font-mono text-text outline-none ${
            capturing ? 'border-accent' : 'border-line'
          }`}
        />
      </div>
      {overlays.shortcut && !overlays.shortcutActive && (
        <p className="text-sm text-warn">
          Raccourci indisponible : une autre application l&apos;utilise déjà. Choisis-en un autre.
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={() => run(window.rlstudio.startEditMode())}>
          <MoveIcon size={16} /> Placer les overlays à la souris
        </Button>
        <span className="text-sm text-mute">
          Déplace et redimensionne tes overlays directement sur l&apos;écran.
        </span>
      </div>
    </Panel>
  )
}
