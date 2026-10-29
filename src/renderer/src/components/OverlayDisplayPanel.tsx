import { useState } from 'react'
import { acceleratorFromKey } from '@core/index'
import { useAction, useApp } from '../appContext'
import { MoveIcon } from './icons'
import { Button, Panel, PanelTitle, Toggle } from './ui'

/** Où et quand s'affichent les overlays : écran, interrupteur, raccourci, placement à la souris. */
export function OverlayDisplayPanel(): React.JSX.Element {
  const { state, tr } = useApp()
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
      <PanelTitle>{tr('Affichage des overlays', 'Overlay display')}</PanelTitle>

      <div className="flex items-center justify-between gap-4 py-2 text-sm">
        <span className="text-sub">{tr('Écran', 'Display')}</span>
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
        <span className="text-sub">
          {tr('Afficher les overlays dans le jeu', 'Show overlays in the game')}
        </span>
        <Toggle
          label={tr('Afficher les overlays dans le jeu', 'Show overlays in the game')}
          checked={overlays.visible}
          onChange={(visible) => run(window.rlstudio.setOverlaysVisible(visible))}
        />
      </div>

      <div className="flex items-center justify-between gap-4 py-2 text-sm">
        <span className="text-sub">
          {tr('Raccourci pour les masquer / afficher', 'Shortcut to hide / show them')}
        </span>
        <input
          readOnly
          value={
            capturing
              ? tr('Appuie sur le raccourci…', 'Press the shortcut…')
              : (overlays.shortcut ?? tr('Aucun', 'None'))
          }
          onFocus={() => setCapturing(true)}
          onBlur={() => setCapturing(false)}
          onKeyDown={onKeyDown}
          title={tr(
            'Clique, puis appuie sur la combinaison. Retour arrière : supprimer. Échap : annuler.',
            'Click, then press the combination. Backspace: remove. Escape: cancel.'
          )}
          aria-label={tr('Raccourci global', 'Global shortcut')}
          className={`w-52 cursor-pointer rounded-lg border bg-field px-3 py-1.5 text-center font-mono text-text outline-none ${
            capturing ? 'border-accent' : 'border-line'
          }`}
        />
      </div>
      {overlays.shortcut && !overlays.shortcutActive && (
        <p className="text-sm text-warn">
          {tr(
            "Raccourci indisponible : une autre application l'utilise déjà. Choisis-en un autre.",
            'Shortcut unavailable: another application already uses it. Choose another one.'
          )}
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={() => run(window.rlstudio.startEditMode())}>
          <MoveIcon size={16} />{' '}
          {tr('Placer les overlays à la souris', 'Place overlays with the mouse')}
        </Button>
        <span className="text-sm text-mute">
          {tr(
            "Déplace et redimensionne tes overlays directement sur l'écran.",
            'Move and resize your overlays directly on screen.'
          )}
        </span>
      </div>
    </Panel>
  )
}
