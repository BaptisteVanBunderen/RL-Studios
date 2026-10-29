import { useApp } from '../appContext'

/**
 * Aperçu en direct d'un module : la VRAIE page de l'overlay, servie par le serveur local, dans une
 * iframe. Elle reçoit les mêmes données et les mêmes réglages (mise à jour à chaud comprise) que
 * la fenêtre posée sur le jeu ou la source OBS.
 *
 * Réduite pour tenir dans `fitWidth` × `fitHeight` ; jamais agrandie au-delà de `scale`.
 */
export function LivePreview({
  src,
  width,
  height,
  scale = 1,
  fitWidth,
  fitHeight
}: {
  src: string
  width: number
  height: number
  scale?: number
  fitWidth: number
  fitHeight: number
}): React.JSX.Element {
  const { tr } = useApp()
  const factor = Math.min(scale, fitWidth / width, fitHeight / height)

  return (
    <div
      className="relative overflow-hidden"
      style={{ width: Math.round(width * factor), height: Math.round(height * factor) }}
    >
      <iframe
        src={src}
        title={tr('Aperçu en direct', 'Live preview')}
        // La page tourne sur l'origine du serveur d'overlays, pas sur celle du client : même isolement
        // qu'une source OBS. `allow-same-origin` est nécessaire pour que son WebSocket soit accepté
        // (en-tête Origin du serveur local) ; elle n'a aucun accès au client.
        sandbox="allow-scripts allow-same-origin"
        tabIndex={-1}
        style={{
          width,
          height,
          border: 0,
          transform: `scale(${factor})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
          // Sans cela, une page « claire » dans un client « sombre » reçoit un fond opaque et son
          // fond transparent n'est plus transparent.
          colorScheme: 'normal',
          background: 'transparent'
        }}
      />
    </div>
  )
}
