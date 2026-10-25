import { useState } from 'react'
import type { ConnectionStatus, PackSummary, SessionState } from '@core/index'
import { useAppState } from './useAppState'

const CONNECTION: Record<ConnectionStatus, { label: string; color: string }> = {
  connected: { label: 'Jeu connecté', color: 'bg-emerald-500' },
  'game-closed': { label: 'Jeu non détecté', color: 'bg-zinc-500' },
  'api-disabled': { label: 'API du jeu désactivée', color: 'bg-amber-500' }
}

function streakLabel(streak: number): string {
  if (streak === 0) return '—'
  const n = Math.abs(streak)
  return streak > 0 ? `${n} victoire${n > 1 ? 's' : ''}` : `${n} défaite${n > 1 ? 's' : ''}`
}

function Stat({ label, value }: { label: string; value: string | number }): React.JSX.Element {
  return (
    <div className="rounded-lg bg-zinc-800 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  )
}

function SessionCard({ session }: { session: SessionState }): React.JSX.Element {
  const total = session.wins + session.losses
  const winrate = total === 0 ? '—' : `${Math.round((session.wins / total) * 100)} %`
  return (
    <section className="rounded-xl bg-zinc-900 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Session</h2>
        <button
          className="rounded-md bg-zinc-700 px-3 py-1 text-sm hover:bg-zinc-600"
          onClick={() => void window.rlstudio.resetSession()}
        >
          Réinitialiser
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Victoires" value={session.wins} />
        <Stat label="Défaites" value={session.losses} />
        <Stat label="Winrate" value={winrate} />
        <Stat label="Série" value={streakLabel(session.streak)} />
      </div>
      <p className="mt-3 text-sm text-zinc-400">
        Meilleure série : {session.bestStreak} · Dernier match :{' '}
        {session.lastResult ? (session.lastResult.won ? 'victoire' : 'défaite') : '—'}
      </p>
    </section>
  )
}

function CopyUrl({ url }: { url: string }): React.JSX.Element {
  const [copied, setCopied] = useState<'ok' | 'erreur' | null>(null)
  const copy = (): void => {
    navigator.clipboard.writeText(url).then(
      () => setCopied('ok'),
      () => setCopied('erreur')
    )
    setTimeout(() => setCopied(null), 1500)
  }
  return (
    <div className="mt-1 flex gap-2">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-300"
      />
      <button className="rounded bg-zinc-700 px-2 py-1 text-xs hover:bg-zinc-600" onClick={copy}>
        {copied === 'ok' ? 'Copié' : copied === 'erreur' ? 'Échec' : 'Copier'}
      </button>
    </div>
  )
}

function PackCard({ pack, baseUrl }: { pack: PackSummary; baseUrl: string }): React.JSX.Element {
  return (
    <article className="rounded-lg bg-zinc-800 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">{pack.name}</h3>
        <span className="text-xs text-zinc-400">
          v{pack.version}
          {pack.author ? ` · ${pack.author}` : ''}
        </span>
      </div>
      {pack.description && <p className="text-sm text-zinc-400">{pack.description}</p>}
      <ul className="mt-3 space-y-3">
        {pack.modules.map((m) => (
          <li key={m.key}>
            <div className="flex items-center justify-between text-sm">
              <span>
                {m.name}{' '}
                <span className="text-xs text-zinc-500">
                  {m.size.width}×{m.size.height}
                </span>
              </span>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={m.enabled}
                  onChange={(e) => void window.rlstudio.setModuleEnabled(m.key, e.target.checked)}
                />
                Afficher dans le jeu
              </label>
            </div>
            <div className="text-xs text-zinc-500">URL OBS (source navigateur) :</div>
            <CopyUrl url={`${baseUrl}/overlay/${m.key}`} />
          </li>
        ))}
      </ul>
      {pack.warnings.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-xs text-amber-400">
          {pack.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </article>
  )
}

function App(): React.JSX.Element {
  const { state, error } = useAppState()

  if (error) return <p className="p-6 text-red-400">{error}</p>
  if (!state) return <p className="p-6 text-zinc-400">Chargement…</p>

  const connection = CONNECTION[state.connection]
  const { packs, invalid } = state.packs

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">RL Studio</h1>
        <span className="flex items-center gap-2 text-sm">
          <span className={`h-2.5 w-2.5 rounded-full ${connection.color}`} />
          {connection.label}
        </span>
      </header>

      <SessionCard session={state.session} />

      <section className="rounded-xl bg-zinc-900 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Packs d&apos;overlays</h2>
          <button
            className="rounded-md bg-zinc-700 px-3 py-1 text-sm hover:bg-zinc-600"
            onClick={() => void window.rlstudio.reloadPacks()}
          >
            Actualiser
          </button>
        </div>

        {packs.length === 0 && invalid.length === 0 && (
          <p className="text-sm text-zinc-400">
            Aucun pack trouvé. Dépose un dossier de pack dans le dossier « overlays », puis
            actualise.
          </p>
        )}

        <div className="space-y-3">
          {packs.map((pack) => (
            <PackCard key={pack.id} pack={pack} baseUrl={state.overlayBaseUrl} />
          ))}
          {invalid.map((pack) => (
            <article key={pack.id} className="rounded-lg border border-red-900 bg-red-950/40 p-4">
              <h3 className="font-semibold text-red-300">{pack.id} (non chargé)</h3>
              <ul className="mt-2 list-disc pl-5 text-xs text-red-300">
                {pack.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

export default App
