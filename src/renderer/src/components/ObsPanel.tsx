import { useState } from 'react'
import type { ModuleSummary } from '@core/index'
import { useApp } from '../appContext'
import { CheckIcon } from './icons'
import { Button, Panel, PanelTitle } from './ui'

/** Copie un texte ; l'API moderne d'abord, sinon l'ancienne méthode (page sans focus, etc.). */
async function copyText(text: string, failure: string): Promise<void> {
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
  if (!ok) throw new Error(failure)
}

/** Lien du module pour une source « Navigateur » d'OBS, prêt à être copié-collé. */
export function ObsPanel({ module }: { module: ModuleSummary }): React.JSX.Element {
  const { state, report, tr } = useApp()
  const [copied, setCopied] = useState(false)
  const url = `${state.overlayBaseUrl}/overlay/${module.key}`

  const copy = (): void => {
    copyText(
      url,
      tr(
        'Impossible de copier : sélectionne le lien et copie-le à la main.',
        'Cannot copy: select the link and copy it by hand.'
      )
    )
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(report)
  }

  return (
    <Panel>
      <PanelTitle>{tr('Source OBS', 'OBS source')}</PanelTitle>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          aria-label={tr('Lien OBS du module', 'OBS link of the module')}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-xl border border-line bg-field px-3 py-2 font-mono text-xs outline-none focus:border-accent"
        />
        <Button variant="primary" onClick={copy} className="shrink-0">
          {copied ? (
            <>
              <CheckIcon size={16} /> {tr('Copié', 'Copied')}
            </>
          ) : (
            tr('Copier', 'Copy')
          )}
        </Button>
      </div>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-sub">
        <li>
          {tr('Dans OBS : Sources,', 'In OBS: Sources,')} <b className="text-text">+</b>,{' '}
          <b className="text-text">{tr('Navigateur', 'Browser')}</b>.
        </li>
        <li>{tr('Colle le lien dans « URL ».', 'Paste the link into “URL”.')}</li>
        <li>
          {tr('Largeur', 'Width')} <span className="font-mono text-text">{module.size.width}</span>,{' '}
          {tr('hauteur', 'height')}{' '}
          <span className="font-mono text-text">{module.size.height}</span>
          {tr(
            ' : pour agrandir, redimensionne la source dans OBS.',
            ': to enlarge it, resize the source in OBS.'
          )}
        </li>
      </ol>
      <p className="mt-3 text-sm text-mute">
        {tr(
          "Le fond est transparent et les réglages de ce module s'appliquent aussi dans OBS. RL Studio doit être lancé.",
          'The background is transparent and this module settings also apply in OBS. RL Studio must be running.'
        )}
      </p>
    </Panel>
  )
}
