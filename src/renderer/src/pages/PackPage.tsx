import type { ModuleSummary } from '@core/index'
import { useAction, useApp } from '../appContext'
import { ChevronRightIcon, InfoIcon } from '../components/icons'
import { LivePreview } from '../components/LivePreview'
import { PageHeader } from '../components/PageHeader'
import { Button, Chip, Toggle } from '../components/ui'

function ModuleRow({ module }: { module: ModuleSummary }): React.JSX.Element {
  const { state, go } = useApp()
  const run = useAction()
  const n = module.settings.length

  return (
    <article
      onClick={() => go({ name: 'module', key: module.key })}
      className={`flex cursor-pointer items-center gap-4 rounded-2xl border bg-card p-4 transition ${
        module.enabled ? 'border-accent' : 'border-line hover:border-line-hover'
      }`}
    >
      <div className="flex h-28 w-40 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-tile">
        <LivePreview
          src={`${state.overlayBaseUrl}/overlay/${module.key}`}
          width={module.size.width}
          height={module.size.height}
          fitWidth={144}
          fitHeight={100}
        />
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="truncate text-xl font-bold">{module.name}</h3>
        <p className="truncate text-sm text-sub">{module.description}</p>
        <div className="mt-3 flex gap-2">
          <Chip>
            {module.size.width} × {module.size.height}
          </Chip>
          <Chip accent={n > 0}>
            {n} réglage{n > 1 ? 's' : ''}
          </Chip>
        </div>
      </div>

      <Toggle
        label={`Afficher « ${module.name} » dans le jeu`}
        checked={module.enabled}
        onChange={(enabled) => run(window.rlstudio.setModuleEnabled(module.key, enabled))}
      />
      <ChevronRightIcon className="text-mute" />
    </article>
  )
}

export function PackPage({ packId }: { packId: string }): React.JSX.Element {
  const { state, go } = useApp()
  const run = useAction()
  const pack = state.packs.packs.find((p) => p.id === packId)

  if (!pack) {
    return (
      <div className="p-8">
        <p className="text-sub">Ce pack n&apos;existe plus.</p>
        <Button className="mt-4" onClick={() => go({ name: 'library' })}>
          Retour aux overlays
        </Button>
      </div>
    )
  }

  const allActive = pack.modules.every((m) => m.enabled)

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={pack.name}
        subtitle={
          <span className="font-mono">
            {pack.id} · v{pack.version} · {pack.modules.length} module
            {pack.modules.length > 1 ? 's' : ''}
            {pack.author ? ` · ${pack.author}` : ''}
          </span>
        }
        onBack={() => go({ name: 'library' })}
      >
        <Button onClick={() => run(window.rlstudio.openOverlaysFolder())}>Ouvrir le dossier</Button>
        <Button
          variant="primary"
          onClick={() => run(window.rlstudio.setPackEnabled(pack.id, !allActive))}
        >
          {allActive ? 'Tout désactiver' : 'Tout activer'}
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">
          Modules du pack
        </h2>
        <div className="space-y-4">
          {pack.modules.map((module) => (
            <ModuleRow key={module.key} module={module} />
          ))}
        </div>

        {pack.warnings.length > 0 && (
          <ul className="mt-6 list-disc space-y-1 pl-5 font-mono text-xs text-warn">
            {pack.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="px-8 pb-6">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-card px-5 py-3 text-sm text-sub">
          <InfoIcon size={18} className="shrink-0 text-mute" />
          Chaque module est une fenêtre indépendante : active seulement ceux dont tu as besoin, puis
          ouvre-en un pour le placer et le régler.
        </div>
      </div>
    </div>
  )
}
