import { useEffect, useRef, useState } from 'react'
import {
  moveRect,
  offsetFromPosition,
  pick,
  placeInArea,
  scaleFromDrag,
  scaledSize,
  type ModuleSummary,
  type Position,
  type Rect
} from '@core/index'
import { useAppState } from '../useAppState'

/**
 * Couche de placement à la souris : plein écran, transparente, au-dessus des overlays (qui, eux,
 * ne reçoivent jamais la souris). Chaque overlay actif y a un cadre qu'on déplace, et dont on tire
 * le coin bas-droit pour changer l'échelle (proportions verrouillées). Chaque geste est envoyé au
 * processus principal, qui enregistre et déplace la vraie fenêtre en direct.
 */

interface Draft {
  position: Position
  scale: number
}

type Gesture =
  | { kind: 'move'; key: string; startRect: Rect; startX: number; startY: number }
  | { kind: 'resize'; key: string; topLeft: { x: number; y: number } }

export function EditLayer(): React.JSX.Element {
  const { state, error } = useAppState()
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [lastPacks, setLastPacks] = useState(state?.packs)
  const [problem, setProblem] = useState<string | null>(null)

  // Un brouillon n'a de sens que pendant un geste : dès que le main renvoie l'état, hors geste,
  // on repart de ce qu'il a enregistré.
  if (state && state.packs !== lastPacks) {
    setLastPacks(state.packs)
    if (!gesture) setDrafts({})
  }

  // Envoi au main : un seul appel à la fois, et seulement la dernière valeur en attente.
  const queue = useRef(new Map<string, Draft>())
  const busy = useRef(false)
  const flush = (): void => {
    if (busy.current) return
    const next = queue.current.entries().next()
    if (next.done) return
    const [key, draft] = next.value
    queue.current.delete(key)
    busy.current = true
    window.rlstudio
      .setModulePlacement(key, { position: draft.position, scale: draft.scale })
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        busy.current = false
        flush()
      })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') void window.rlstudio.stopEditMode()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (error) return <p className="p-8 text-danger">{error}</p>
  if (!state) return <div />

  const tr = (fr: string, en: string): string => pick(state.language, fr, en)
  const area = state.display.workArea
  const modules = state.packs.packs.flatMap((pack) => pack.modules.filter((m) => m.enabled))

  const current = (module: ModuleSummary): Draft =>
    drafts[module.key] ?? { position: module.position, scale: module.scale }

  const rectOf = (module: ModuleSummary): Rect => {
    const draft = current(module)
    return placeInArea(draft.position, scaledSize(module.size, draft.scale), area)
  }

  const update = (module: ModuleSummary, draft: Draft): void => {
    setDrafts((d) => ({ ...d, [module.key]: draft }))
    queue.current.set(module.key, draft)
    flush()
  }

  /** Position de la souris dans le repère de l'écran (la couche couvre la zone de travail). */
  const pointer = (event: React.PointerEvent): { x: number; y: number } => ({
    x: area.x + event.clientX,
    y: area.y + event.clientY
  })

  const startMove = (event: React.PointerEvent, module: ModuleSummary): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const p = pointer(event)
    setGesture({
      kind: 'move',
      key: module.key,
      startRect: rectOf(module),
      startX: p.x,
      startY: p.y
    })
  }

  const startResize = (event: React.PointerEvent, module: ModuleSummary): void => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = rectOf(module)
    setGesture({ kind: 'resize', key: module.key, topLeft: { x: rect.x, y: rect.y } })
  }

  const onMove = (event: React.PointerEvent, module: ModuleSummary): void => {
    if (!gesture || gesture.key !== module.key) return
    const p = pointer(event)
    const anchor = current(module).position.anchor

    if (gesture.kind === 'move') {
      const rect = moveRect(
        gesture.startRect,
        p.x - gesture.startX,
        p.y - gesture.startY,
        area,
        !event.altKey
      )
      const size = scaledSize(module.size, current(module).scale)
      update(module, {
        position: offsetFromPosition(anchor, rect, size, area),
        scale: current(module).scale
      })
    } else {
      const scale = scaleFromDrag(module.size, gesture.topLeft, p, area)
      const size = scaledSize(module.size, scale)
      // le coin haut-gauche reste en place : seul le coin bas-droit suit la souris
      update(module, { position: offsetFromPosition(anchor, gesture.topLeft, size, area), scale })
    }
  }

  const endGesture = (): void => setGesture(null)

  return (
    <div className="fixed inset-0 select-none bg-[#080b10]/55">
      {modules.map((module) => {
        const rect = rectOf(module)
        const draft = current(module)
        const active = gesture?.key === module.key
        return (
          <div
            key={module.key}
            onPointerDown={(e) => startMove(e, module)}
            onPointerMove={(e) => onMove(e, module)}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            className={`absolute cursor-move touch-none rounded-sm border-2 border-dashed ${
              active ? 'border-accent bg-accent/25' : 'border-accent/80 bg-accent/10'
            }`}
            style={{
              left: rect.x - area.x,
              top: rect.y - area.y,
              width: rect.width,
              height: rect.height
            }}
          >
            <span className="pointer-events-none absolute -top-6 left-0 whitespace-nowrap rounded-md bg-card px-2 py-0.5 font-mono text-xs text-text">
              {module.name} · X {rect.x - area.x} Y {rect.y - area.y} · ×{draft.scale.toFixed(2)}
            </span>
            <div
              onPointerDown={(e) => startResize(e, module)}
              onPointerMove={(e) => {
                e.stopPropagation()
                onMove(e, module)
              }}
              onPointerUp={(e) => {
                e.stopPropagation()
                endGesture()
              }}
              onPointerCancel={endGesture}
              title={tr('Tirer pour redimensionner', 'Drag to resize')}
              className="absolute -right-2 -bottom-2 h-4 w-4 cursor-nwse-resize touch-none rounded-sm border-2 border-bg bg-accent"
            />
          </div>
        )
      })}

      <div className="absolute top-6 left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-2xl border border-line bg-card px-5 py-3 text-sm text-text shadow-lg">
        <span>
          {modules.length === 0
            ? tr(
                'Aucun overlay actif : active-en un dans le client.',
                'No active overlay: enable one in the client.'
              )
            : tr(
                'Glisse un cadre pour déplacer, tire son coin pour redimensionner. Alt : sans aimantation.',
                'Drag a frame to move it, drag its corner to resize. Alt: no snapping.'
              )}
        </span>
        <button
          type="button"
          onClick={() => void window.rlstudio.stopEditMode()}
          className="cursor-pointer rounded-xl border border-accent bg-accent px-4 py-1.5 font-semibold text-bg hover:brightness-110"
        >
          {tr('Terminé (Échap)', 'Done (Esc)')}
        </button>
      </div>
      {problem && (
        <p className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-xl border border-danger/40 bg-card px-4 py-2 text-sm text-danger">
          {problem}
        </p>
      )}
    </div>
  )
}
