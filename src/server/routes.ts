import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname } from 'node:path'
import { ID_PATTERN, type LoadedPack } from '@core/index'
import { resolveInside } from './safePath'

export interface RouteDeps {
  /** Pack chargé et valide, ou `undefined`. Appelé à chaque requête : un rechargement des packs est vu tout de suite. */
  getPack: (id: string) => LoadedPack | undefined
  /** Code du SDK, servi tel quel à `/sdk/rlstudio.js`. */
  sdkSource: string
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4'
}

export function contentTypeFor(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Insère `<base href>` dans une page HTML, pour que ses URL relatives (`session.css`,
 * `../img/logo.png`) se résolvent par rapport à l'emplacement du fichier dans le pack, alors que
 * la page est servie à `/overlay/<pack>/<module>` (sans extension ni sous-dossier).
 *
 * Sans `<head>`, on insère après le doctype (avant lui, le navigateur passerait en mode
 * « quirks »), et à défaut en tête. Une page qui déclare déjà son `<base>` est laissée telle quelle.
 */
export function injectBase(html: string, href: string): string {
  // On cherche dans une copie où les commentaires sont blanchis (même longueur, donc mêmes
  // positions) : un commentaire qui parle de `<base>` ou de `<head>` ne doit rien changer.
  const visible = html.replace(/<!--[\s\S]*?-->/g, (comment) => ' '.repeat(comment.length))
  if (/<base[\s>]/i.test(visible)) return html
  const tag = `<base href="${href}">`

  const head = /<head(?:\s[^>]*)?>/i.exec(visible)
  if (head) {
    const end = head.index + head[0].length
    return html.slice(0, end) + tag + html.slice(end)
  }

  const doctype = /<!doctype[^>]*>/i.exec(visible)
  if (doctype) {
    const end = doctype.index + doctype[0].length
    return html.slice(0, end) + tag + html.slice(end)
  }
  return tag + html
}

type Headers = Record<string, string | number>

function send(res: ServerResponse, status: number, body: string, headers: Headers = {}): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  })
  res.end(body)
}

/**
 * Découpe le chemin de la requête en segments décodés. `null` si l'un d'eux est dangereux.
 * On n'utilise PAS `new URL(req.url)` : `//hote/x` y serait lu comme un hôte, pas comme un chemin.
 */
function parseSegments(url: string | undefined): string[] | null {
  const path = (url ?? '/').split('?')[0].split('#')[0]
  if (!path.startsWith('/')) return null

  const raw = path.slice(1).split('/')
  if (raw[raw.length - 1] === '') raw.pop() // une barre finale est tolérée
  const segments: string[] = []
  for (const part of raw) {
    let segment: string
    try {
      segment = decodeURIComponent(part)
    } catch {
      return null
    }
    // « : » refuse les lecteurs Windows (C:) et les flux alternatifs NTFS (fichier::$DATA).
    if (segment === '' || segment === '.' || segment === '..' || /[\\/:\0]/.test(segment)) {
      return null
    }
    segments.push(segment)
  }
  return segments
}

/**
 * Routes HTTP du serveur d'overlays :
 * - `/sdk/rlstudio.js` : le SDK ;
 * - `/overlay/<pack>/<module>` : la page d'un module (avec `<base>` injecté) ;
 * - `/overlay/<pack>/<chemin>` : un fichier du pack (styles, scripts, images, polices…).
 * Tout le reste : 404. Seules les méthodes GET et HEAD sont acceptées.
 */
export function createRequestHandler(
  deps: RouteDeps
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    handle(req, res, deps).catch((error) => {
      console.error("Serveur d'overlays : erreur HTTP", error)
      if (!res.headersSent) send(res, 500, 'Erreur interne')
      else res.destroy()
    })
  }
}

async function handle(req: IncomingMessage, res: ServerResponse, deps: RouteDeps): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Méthode non autorisée', { Allow: 'GET, HEAD' })
  }
  const head = req.method === 'HEAD'

  const segments = parseSegments(req.url)
  if (!segments) return send(res, 400, 'Requête invalide')

  if (segments.length === 2 && segments[0] === 'sdk' && segments[1] === 'rlstudio.js') {
    return sendBuffer(res, deps.sdkSource, 'text/javascript; charset=utf-8', head)
  }

  if (segments[0] !== 'overlay' || segments.length < 3) return send(res, 404, 'Introuvable')

  const [, packId, ...rest] = segments
  if (!ID_PATTERN.test(packId)) return send(res, 404, 'Introuvable')
  const pack = deps.getPack(packId)
  if (!pack) return send(res, 404, 'Pack introuvable')

  // Un seul segment qui est l'identifiant d'un module : la page du module.
  if (rest.length === 1) {
    const module = pack.manifest.modules.find((m) => m.id === rest[0])
    if (module) {
      const file = await resolveInside(pack.dir, module.entry)
      if (!file?.isFile) return send(res, 404, 'Page du module introuvable')

      const html = await readFile(file.path, 'utf8')
      const entryDir = module.entry
        .split(/[\\/]/)
        .filter((s) => s !== '' && s !== '.')
        .slice(0, -1)
      const base =
        `/overlay/${encodeURIComponent(pack.id)}/` +
        entryDir.map((s) => `${encodeURIComponent(s)}/`).join('')
      return sendBuffer(res, injectBase(html, base), 'text/html; charset=utf-8', head)
    }
  }

  // Sinon : un fichier du pack, strictement à l'intérieur de son dossier.
  const file = await resolveInside(pack.dir, rest)
  if (!file?.isFile) return send(res, 404, 'Introuvable')

  res.writeHead(200, {
    'Content-Type': contentTypeFor(file.path),
    'Content-Length': file.size,
    'Cache-Control': 'no-store', // les packs sont éditables : toujours la version du disque
    'X-Content-Type-Options': 'nosniff'
  })
  if (head) return void res.end()

  const stream = createReadStream(file.path)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

function sendBuffer(res: ServerResponse, body: string, type: string, head: boolean): void {
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(head ? undefined : body)
}
