import { useState } from 'react'
import type { ModuleSummary } from '@core/index'
import { useApp } from '../appContext'
import { CheckIcon } from './icons'
import { Button, Panel, PanelTitle } from './ui'

/** Copie un texte ; l'API moderne d'abord, sinon l'ancienne méthode (page sans focus, etc.). */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    /* repli ci-dessous */
  }
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  area.remove()
  if (!ok) throw new Error('Impossible de copier : sélectionne le lien et copie-le à la main.')
}

/** Lien du module pour une source « Navigateur » d'OBS, prêt à être copié-collé. */
export function ObsPanel({ module }: { module: ModuleSummary }): React.JSX.Element {
  const { state, report } = useApp()
  const [copied, setCopied] = useState(false)
  const url = `${state.overlayBaseUrl}/overlay/${module.key}`

  const copy = (): void => {
    copyText(url)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(report)
  }

  return (
    <Panel>
      <PanelTitle>Source OBS</PanelTitle>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          aria-label="Lien OBS du module"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-xl border border-line bg-field px-3 py-2 font-mono text-xs outline-none focus:border-accent"
        />
        <Button variant="primary" onClick={copy} className="shrink-0">
          {copied ? (
            <>
              <CheckIcon size={16} /> Copié
            </>
          ) : (
            'Copier'
          )}
        </Button>
      </div>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-sub">
        <li>
          Dans OBS : Sources, <b className="text-text">+</b>,{' '}
          <b className="text-text">Navigateur</b>.
        </li>
        <li>Colle le lien dans « URL ».</li>
        <li>
          Largeur <span className="font-mono text-text">{module.size.width}</span>, hauteur{' '}
          <span className="font-mono text-text">{module.size.height}</span> : pour agrandir,
          redimensionne la source dans OBS.
        </li>
      </ol>
      <p className="mt-3 text-sm text-mute">
        Le fond est transparent et les réglages de ce module s&apos;appliquent aussi dans OBS. RL
        Studio doit être lancé.
      </p>
    </Panel>
  )
}
