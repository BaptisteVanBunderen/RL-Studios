import { request } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LoadedPack } from '@core/index'
import { OverlayServer } from './OverlayServer'
import { contentTypeFor, injectBase } from './routes'
import { PNG_BYTES, createDemoPack, packSource } from './test-utils/fixtures'

interface Reply {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}

/** Requête HTTP BRUTE : le chemin part tel quel (fetch normaliserait « .. » avant l'envoi). */
function raw(port: number, path: string, method = 'GET'): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) })
      )
    })
    req.on('error', reject)
    req.end()
  })
}

describe('serveur HTTP des overlays', () => {
  let base: string
  let server: OverlayServer
  let packs: Map<string, LoadedPack>
  let port: number

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'rl-studio-http-'))
    packs = new Map([['demo', await createDemoPack(base)]])
    server = new OverlayServer({
      port: 0,
      packs: packSource(packs),
      sdkSource: '/* SDK */ var x=1'
    })
    await server.start()
    port = server.port
  })
  afterEach(async () => {
    await server.stop()
    await rm(base, { recursive: true, force: true })
  })

  describe('SDK', () => {
    it('sert /sdk/rlstudio.js tel quel, en JavaScript', async () => {
      const r = await raw(port, '/sdk/rlstudio.js')
      expect(r.status).toBe(200)
      expect(r.headers['content-type']).toBe('text/javascript; charset=utf-8')
      expect(r.body.toString()).toBe('/* SDK */ var x=1')
    })

    it('HEAD : les en-têtes sans le corps', async () => {
      const r = await raw(port, '/sdk/rlstudio.js', 'HEAD')
      expect(r.status).toBe(200)
      expect(r.headers['content-length']).toBe(String(Buffer.byteLength('/* SDK */ var x=1')))
      expect(r.body.length).toBe(0)
    })
  })

  describe('page d’un module : /overlay/<pack>/<module>', () => {
    it('sert la page avec <base> pour que les URL relatives marchent', async () => {
      const r = await raw(port, '/overlay/demo/bar')
      expect(r.status).toBe(200)
      expect(r.headers['content-type']).toBe('text/html; charset=utf-8')
      const html = r.body.toString('utf8')
      expect(html).toContain('<head><base href="/overlay/demo/modules/">')
      expect(html).toContain('href="bar.css"') // l'URL relative de l'auteur est intacte
      expect(html).toContain('Élément accentué ✓') // UTF-8 conservé
    })

    it('un module à la racine du pack : base = dossier du pack', async () => {
      const html = (await raw(port, '/overlay/demo/racine')).body.toString()
      expect(html).toContain('<base href="/overlay/demo/">')
    })

    it('sans <head>, la base est insérée après le doctype', async () => {
      const html = (await raw(port, '/overlay/demo/nohead')).body.toString()
      expect(html.startsWith('<!doctype html><base href="/overlay/demo/modules/">')).toBe(true)
    })

    it('tolère une barre finale et une query string', async () => {
      expect((await raw(port, '/overlay/demo/bar/')).status).toBe(200)
      expect((await raw(port, '/overlay/demo/bar?obs=1&x=2')).status).toBe(200)
    })

    it('HEAD : pas de corps', async () => {
      const r = await raw(port, '/overlay/demo/bar', 'HEAD')
      expect(r.status).toBe(200)
      expect(r.body.length).toBe(0)
      expect(Number(r.headers['content-length'])).toBeGreaterThan(0)
    })

    it('la page est relue du disque à chaque requête (packs éditables)', async () => {
      await writeFile(
        join(packs.get('demo')!.dir, 'index.html'),
        '<!doctype html><html><head></head><body>modifié</body></html>'
      )
      expect((await raw(port, '/overlay/demo/racine')).body.toString()).toContain('modifié')
    })

    it('page supprimée après le chargement : 404', async () => {
      await rm(join(packs.get('demo')!.dir, 'modules', 'bar.html'))
      expect((await raw(port, '/overlay/demo/bar')).status).toBe(404)
    })
  })

  describe('fichiers du pack : /overlay/<pack>/<chemin>', () => {
    it('sert une feuille de style, avec le bon type et sans cache', async () => {
      const r = await raw(port, '/overlay/demo/modules/bar.css')
      expect(r.status).toBe(200)
      expect(r.headers['content-type']).toBe('text/css; charset=utf-8')
      expect(r.headers['cache-control']).toBe('no-store')
      expect(r.headers['x-content-type-options']).toBe('nosniff')
      expect(r.body.toString()).toBe('body { color: red }')
    })

    it('sert un fichier binaire octet pour octet', async () => {
      const r = await raw(port, '/overlay/demo/assets/logo.png')
      expect(r.status).toBe(200)
      expect(r.headers['content-type']).toBe('image/png')
      expect(r.headers['content-length']).toBe(String(PNG_BYTES.length))
      expect(r.body.equals(PNG_BYTES)).toBe(true)
    })

    it('sert un fichier à la racine du pack', async () => {
      expect((await raw(port, '/overlay/demo/style.css')).status).toBe(200)
    })

    it('type inconnu : application/octet-stream', async () => {
      const r = await raw(port, '/overlay/demo/assets/donnees.xyz')
      expect(r.headers['content-type']).toBe('application/octet-stream')
    })

    it('HEAD : en-têtes sans corps', async () => {
      const r = await raw(port, '/overlay/demo/assets/logo.png', 'HEAD')
      expect(r.status).toBe(200)
      expect(r.headers['content-length']).toBe(String(PNG_BYTES.length))
      expect(r.body.length).toBe(0)
    })

    it('décode les caractères encodés d’un nom de fichier légitime', async () => {
      await writeFile(join(packs.get('demo')!.dir, 'mon fichier.css'), 'x{}')
      expect((await raw(port, '/overlay/demo/mon%20fichier.css')).status).toBe(200)
    })
  })

  describe('404 et méthodes', () => {
    it.each([
      '/',
      '/autre',
      '/overlay',
      '/overlay/demo', // pas de module ni de fichier
      '/overlay/demo/', // idem
      '/overlay/inconnu/bar', // pack inconnu
      '/overlay/DEMO/bar', // identifiant invalide
      '/overlay/demo/inconnu',
      '/overlay/demo/modules', // un dossier n'est pas un fichier
      '/overlay/demo/modules/absent.css',
      '/sdk',
      '/sdk/autre.js'
    ])('%s → 404', async (path) => {
      expect((await raw(port, path)).status).toBe(404)
    })

    it('un pack retiré après coup n’est plus servi', async () => {
      expect((await raw(port, '/overlay/demo/bar')).status).toBe(200)
      packs.delete('demo')
      expect((await raw(port, '/overlay/demo/bar')).status).toBe(404)
      expect((await raw(port, '/overlay/demo/style.css')).status).toBe(404)
    })

    it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('%s → 405 avec Allow', async (method) => {
      const r = await raw(port, '/overlay/demo/bar', method)
      expect(r.status).toBe(405)
      expect(r.headers.allow).toBe('GET, HEAD')
    })
  })

  describe('évasion de dossier : aucune requête n’atteint un fichier hors du pack', () => {
    const attacks = [
      '/overlay/demo/../secret.txt',
      '/overlay/demo/modules/../../secret.txt',
      '/overlay/demo/%2e%2e/secret.txt',
      '/overlay/demo/%2E%2E/%2E%2E/secret.txt',
      '/overlay/demo/..%2Fsecret.txt',
      '/overlay/demo/..%2f..%2fsecret.txt',
      '/overlay/demo/modules/..%5C..%5Csecret.txt',
      '/overlay/demo%2F..%2Fsecret.txt',
      '/overlay/demo/..%252fsecret.txt', // double encodage : reste littéral, donc introuvable
      '/overlay/demo//secret.txt',
      '//overlay/demo/style.css',
      '/overlay//demo/style.css',
      '/overlay/demo/C:/Windows/win.ini',
      '/overlay/demo/C%3A/Windows/win.ini',
      '/overlay/demo/style.css::$DATA',
      '/overlay/demo/%00',
      '/overlay/demo/style.css%00.png',
      '/overlay/demo/%',
      '/overlay/demo/%zz',
      '/overlay/demo-evil/secret.txt',
      '/overlay/demo/..\\secret.txt',
      '/overlay/demo/.%2e/secret.txt',
      '/overlay/demo/%2e/%2e%2e/secret.txt'
    ]

    it.each(attacks)('%s', async (path) => {
      const r = await raw(port, path)
      expect([400, 404]).toContain(r.status)
      expect(r.body.toString()).not.toContain('SECRET')
    })

    it('même avec HEAD', async () => {
      const r = await raw(port, '/overlay/demo/../secret.txt', 'HEAD')
      expect([400, 404]).toContain(r.status)
    })
  })

  describe('contentTypeFor', () => {
    it.each([
      ['a.HTML', 'text/html; charset=utf-8'],
      ['a.js', 'text/javascript; charset=utf-8'],
      ['a.json', 'application/json; charset=utf-8'],
      ['a.svg', 'image/svg+xml'],
      ['a.woff2', 'font/woff2'],
      ['a.mp3', 'audio/mpeg'],
      ['a.webm', 'video/webm'],
      ['a', 'application/octet-stream'],
      ['a.exe', 'application/octet-stream']
    ])('%s → %s', (name, type) => {
      expect(contentTypeFor(name)).toBe(type)
    })
  })
})

describe('injectBase', () => {
  const href = '/overlay/p/'

  it('insère après <head>, avec ou sans attributs, quelle que soit la casse', () => {
    expect(injectBase('<html><head><title>x</title></head></html>', href)).toBe(
      '<html><head><base href="/overlay/p/"><title>x</title></head></html>'
    )
    expect(injectBase('<HEAD lang="fr"><meta></HEAD>', href)).toBe(
      '<HEAD lang="fr"><base href="/overlay/p/"><meta></HEAD>'
    )
  })

  it('ne confond pas <header> avec <head>', () => {
    expect(injectBase('<!doctype html><header>x</header>', href)).toBe(
      '<!doctype html><base href="/overlay/p/"><header>x</header>'
    )
  })

  it('sans head : après le doctype, jamais avant (le mode quirks serait activé)', () => {
    expect(injectBase('<!DOCTYPE html>\n<body>x</body>', href)).toBe(
      '<!DOCTYPE html><base href="/overlay/p/">\n<body>x</body>'
    )
  })

  it('sans head ni doctype : en tête', () => {
    expect(injectBase('<p>x</p>', href)).toBe('<base href="/overlay/p/"><p>x</p>')
  })

  it('respecte une page qui définit déjà son <base>', () => {
    const html = '<head><base href="/autre/"></head>'
    expect(injectBase(html, href)).toBe(html)
  })

  it('un commentaire qui parle de <base> ne compte pas comme un <base> (régression)', () => {
    const html = '<head><!-- le serveur ajoute un <base> adapté --><meta></head>'
    expect(injectBase(html, href)).toBe(
      '<head><base href="/overlay/p/"><!-- le serveur ajoute un <base> adapté --><meta></head>'
    )
  })

  it('un <head> écrit dans un commentaire n’est pas le vrai <head>', () => {
    const html = '<!-- ex : <head> --><html><head><meta></head></html>'
    expect(injectBase(html, href)).toBe(
      '<!-- ex : <head> --><html><head><base href="/overlay/p/"><meta></head></html>'
    )
  })

  it('un commentaire sur plusieurs lignes est aussi ignoré', () => {
    const html = '<head>\n<!--\n<base href="/x/">\n-->\n</head>'
    expect(injectBase(html, href)).toBe(
      '<head><base href="/overlay/p/">\n<!--\n<base href="/x/">\n-->\n</head>'
    )
  })
})
