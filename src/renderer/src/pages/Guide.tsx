import { useApp } from '../appContext'
import { Markdown } from '../components/Markdown'
import { PageHeader } from '../components/PageHeader'
// Le guide est le fichier de docs/ lui-même : une seule source par langue, embarquée au build.
import guideEn from '../../../../docs/overlay-guide.md?raw'
import guideFr from '../../../../docs/overlay-guide.fr.md?raw'

export function Guide(): React.JSX.Element {
  const { go, state, tr } = useApp()

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={tr('Guide de création', 'Creation guide')}
        subtitle={tr(
          'Crée tes propres overlays : manifeste, réglages, données du jeu',
          'Build your own overlays: manifest, settings, game data'
        )}
        onBack={() => go({ name: 'library' })}
      />
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl">
          <Markdown source={state.language === 'fr' ? guideFr : guideEn} />
        </div>
      </div>
    </div>
  )
}
