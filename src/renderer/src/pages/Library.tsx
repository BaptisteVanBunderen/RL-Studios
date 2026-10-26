import type { InvalidPackSummary, PackSummary } from '@core/index'
import { useAction, useApp } from '../appContext'
import { ConnectionPill } from '../components/ConnectionPill'
import { RefreshIcon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'
import { SessionBar } from '../components/SessionControls'
import { Button, Chip, IconButton, Toggle } from '../components/ui'

/** Vignette d'un pack : son image d'aperçu, sinon ses initiales. */
function PackTile({ pack, baseUrl }: { pack: PackSummary; baseUrl: string }): React.JSX.Element {
  const initials = pack.name
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="flex h-24 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-tile">
      {pack.preview ? (
        <img
          src={`${baseUrl}/overlay/${pack.id}/${pack.preview}`}
          alt=""
          className="h-full w-full object-contain"
        />
      ) : (
        <span className="font-mono text-2xl font-semibold text-mute">{initials}</span>
      )}
    </div>
  )
}

function PackCard({ pack }: { pack: PackSummary }): React.JSX.Element {
  const { state, go } = useApp()
  const run = useAction()
  const total = pack.modules.length
  const active = pack.modules.filter((m) => m.enabled).length

  return (
    <article
      onClick={() => go({ name: 'pack', packId: pack.id })}
      className={`cursor-pointer rounded-2xl border bg-card p-4 transition ${
        active > 0 ? 'border-accent' : 'border-line hover:border-line-hover'
      }`}
    >
      <div className="flex gap-4">
        <PackTile pack={pack} baseUrl={state.overlayBaseUrl} />
        <div className="min-w-0">
          <h3 className="truncate text-xl font-bold">{pack.name}</h3>
          <p className="line-clamp-2 text-sm text-sub">{pack.description}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex gap-2">
          <Chip>
            {total} module{total > 1 ? 's' : ''}
          </Chip>
          {active > 0 && (
            <Chip accent>
              {active} actif{active > 1 ? 's' : ''}
            </Chip>
          )}
        </div>
        {/* Allumé = au moins un module actif ; un clic éteint tout, ou allume tout si rien n'est actif. */}
        <Toggle
          label={`Activer tous les modules de ${pack.name}`}
          checked={active > 0}
          onChange={() => run(window.rlstudio.setPackEnabled(pack.id, active === 0))}
        />
      </div>
    </article>
  )
}

function InvalidPackCard({ pack }: { pack: InvalidPackSummary }): React.JSX.Element {
  return (
    <article className="rounded-2xl border border-danger/40 bg-danger/5 p-4">
      <h3 className="text-lg font-bold text-danger">{pack.id}</h3>
      <p className="text-sm text-sub">Ce dossier n&apos;a pas pu être chargé :</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs text-danger">
        {pack.errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </article>
  )
}

export function Library(): React.JSX.Element {
  const { state } = useApp()
  const run = useAction()
  const { packs, invalid } = state.packs
  const activeModules = packs.reduce((n, p) => n + p.modules.filter((m) => m.enabled).length, 0)

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Overlays"
        subtitle={`${packs.length} pack${packs.length > 1 ? 's' : ''} installé${packs.length > 1 ? 's' : ''} · ${activeModules} module${activeModules > 1 ? 's' : ''} actif${activeModules > 1 ? 's' : ''}`}
      >
        <ConnectionPill />
        <IconButton
          label="Actualiser la liste des packs"
          onClick={() => run(window.rlstudio.reloadPacks())}
        >
          <RefreshIcon />
        </IconButton>
        <Button onClick={() => run(window.rlstudio.openOverlaysFolder())}>Dossier overlays</Button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {packs.map((pack) => (
            <PackCard key={pack.id} pack={pack} />
          ))}
          {invalid.map((pack) => (
            <InvalidPackCard key={pack.id} pack={pack} />
          ))}
          <button
            type="button"
            onClick={() => run(window.rlstudio.openOverlaysFolder())}
            className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-line-hover bg-transparent p-6 text-sub transition hover:border-sub hover:text-text"
          >
            <span className="text-2xl leading-none">+</span>
            <span className="font-semibold">Ajouter un overlay</span>
            <span className="text-sm text-mute">Dépose un dossier dans overlays/</span>
          </button>
        </div>
      </div>

      <div className="px-8 pb-6">
        <SessionBar />
      </div>
    </div>
  )
}
