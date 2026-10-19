import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseManifest, settingDefaults, type LoadedPack } from '@core/index'
import type { PackSource } from '../OverlayServer'

export const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 255])

/**
 * Crée sur disque un pack de test dans `<base>/overlays/demo` et renvoie sa description chargée.
 * Un fichier `secret.txt` est placé à côté du pack ET dans un dossier voisin au nom proche
 * (`demo-evil`) : aucune requête ne doit jamais les atteindre.
 */
export async function createDemoPack(base: string): Promise<LoadedPack> {
  const overlays = join(base, 'overlays')
  const dir = join(overlays, 'demo')

  const files: Record<string, string | Buffer> = {
    'modules/bar.html':
      '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<link rel="stylesheet" href="bar.css">\n</head>\n<body>Élément accentué ✓</body>\n</html>\n',
    'modules/bar.css': 'body { color: red }',
    'index.html': '<!doctype html><html><head></head><body>racine</body></html>',
    'assets/logo.png': PNG_BYTES,
    'assets/police.woff2': Buffer.from([1, 2, 3]),
    'assets/donnees.xyz': 'inconnu',
    'style.css': 'a { color: blue }',
    'modules/sans-head.html': '<!doctype html><body>sans head</body>'
  }
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  await writeFile(join(overlays, 'secret.txt'), 'SECRET')
  await mkdir(join(overlays, 'demo-evil'), { recursive: true })
  await writeFile(join(overlays, 'demo-evil', 'secret.txt'), 'SECRET')
  await writeFile(join(base, 'secret.txt'), 'SECRET')

  const raw = {
    manifestVersion: 1,
    name: 'Démo',
    version: '1.0.0',
    modules: [
      {
        id: 'bar',
        name: 'Barre',
        entry: 'modules/bar.html',
        size: { width: 100, height: 40 },
        data: ['session'],
        settings: [{ key: 'color', type: 'color', label: 'Couleur', default: '#ff0000' }]
      },
      { id: 'racine', name: 'Racine', entry: 'index.html', size: { width: 10, height: 10 } },
      {
        id: 'nohead',
        name: 'Sans head',
        entry: 'modules/sans-head.html',
        size: { width: 10, height: 10 },
        data: ['match', 'event']
      },
      { id: 'vide', name: 'Aucune donnée', entry: 'index.html', size: { width: 10, height: 10 } }
    ]
  }
  // Le manifeste existe aussi sur disque : PackLoader le relit tel quel.
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(raw, null, 2))

  const result = parseManifest(raw)
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return { id: 'demo', dir, manifest: result.manifest, warnings: [] }
}

/** Source de packs en mémoire ; `packs` peut être modifiée par le test (retirer un pack…). */
export function packSource(packs: Map<string, LoadedPack>): PackSource {
  return {
    getPack: (id) => packs.get(id),
    getSettings: (packId, moduleId) => {
      const module = packs.get(packId)?.manifest.modules.find((m) => m.id === moduleId)
      return module ? settingDefaults(module) : {}
    }
  }
}
