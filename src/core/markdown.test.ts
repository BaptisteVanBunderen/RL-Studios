import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseManifest } from './manifest'
import { parseInlines, parseMarkdown, type Block } from './markdown'

const FENCE = '```'

describe('parseInlines', () => {
  it('sépare texte, code et gras', () => {
    expect(parseInlines('un `a-z` et **deux** mots')).toEqual([
      { type: 'text', text: 'un ' },
      { type: 'code', text: 'a-z' },
      { type: 'text', text: ' et ' },
      { type: 'bold', text: 'deux' },
      { type: 'text', text: ' mots' }
    ])
  })

  it('un texte sans balise reste un seul morceau', () => {
    expect(parseInlines('rien de spécial')).toEqual([{ type: 'text', text: 'rien de spécial' }])
  })
})

describe('parseMarkdown', () => {
  it('lit titres, paragraphes sur plusieurs lignes et citations', () => {
    const blocks = parseMarkdown('# Titre\n\nune ligne\nsuite\n\n> astuce\n> en deux lignes\n')
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'quote'])
    expect(blocks[0]).toMatchObject({ level: 1 })
    expect(blocks[1]).toEqual({
      type: 'paragraph',
      inlines: [{ type: 'text', text: 'une ligne suite' }]
    })
    expect(blocks[2]).toEqual({
      type: 'quote',
      inlines: [{ type: 'text', text: 'astuce en deux lignes' }]
    })
  })

  it('lit un bloc de code avec son langage, sans interpréter son contenu', () => {
    const blocks = parseMarkdown(`${FENCE}js\n# pas un titre\n- pas une liste\n${FENCE}\n`)
    expect(blocks).toEqual([{ type: 'code', lang: 'js', text: '# pas un titre\n- pas une liste' }])
  })

  it('une liste numérotée interrompue par du code reprend à son numéro', () => {
    const blocks = parseMarkdown(`1. a\n2. b\n\n${FENCE}\nx\n${FENCE}\n\n3. c\n`)
    expect(blocks.map((b) => b.type)).toEqual(['list', 'code', 'list'])
    expect(blocks[2]).toMatchObject({ ordered: true, start: 3 })
  })

  it('lit un tableau', () => {
    const blocks = parseMarkdown('| a | b |\n| --- | --- |\n| `x` | **y** |\n| 1 | 2 |\n')
    expect(blocks).toHaveLength(1)
    const table = blocks[0] as Extract<Block, { type: 'table' }>
    expect(table.header).toHaveLength(2)
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0][0]).toEqual([{ type: 'code', text: 'x' }])
  })

  it('une ligne qui ressemble à un tableau sans séparateur ne boucle pas', () => {
    const blocks = parseMarkdown('| seul |\n\nsuite\n')
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph'])
  })
})

const GUIDES = ['overlay-guide.md', 'overlay-guide.fr.md']

describe.each(GUIDES)('docs/%s', (file) => {
  const source = readFileSync(join(process.cwd(), 'docs', file), 'utf8')
  const blocks = parseMarkdown(source)

  const texts = (inlines: { text: string }[]): string => inlines.map((i) => i.text).join('')
  const cells = (b: Extract<Block, { type: 'table' }>): string[] =>
    [b.header, ...b.rows].flat().map(texts)

  it('commence par un titre et se découpe en sections', () => {
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 1 })
    expect(blocks.filter((b) => b.type === 'heading' && b.level === 2).length).toBeGreaterThan(5)
  })

  it("n'utilise que ce que le rendu sait afficher (aucune balise restée telle quelle)", () => {
    const stray: string[] = []
    for (const block of blocks) {
      if (block.type === 'code') continue
      const texts_: string[] =
        block.type === 'table'
          ? cells(block)
          : block.type === 'list'
            ? block.items.map(texts)
            : [texts(block.inlines)]
      for (const t of texts_) if (/\*\*|`|^#|^\|/.test(t)) stray.push(t)
    }
    expect(stray).toEqual([])
  })

  it('chaque tableau a le même nombre de colonnes à toutes ses lignes', () => {
    for (const block of blocks) {
      if (block.type !== 'table') continue
      for (const row of block.rows) expect(row).toHaveLength(block.header.length)
    }
  })

  it('tous les blocs de code sont fermés', () => {
    expect(source.split(FENCE).length % 2).toBe(1)
  })

  it('le manifeste du pas-à-pas est accepté tel quel par le vrai validateur', () => {
    const json = blocks.find(
      (b): b is Extract<Block, { type: 'code' }> =>
        b.type === 'code' && b.lang === 'json' && b.text.includes('"manifestVersion"')
    )
    expect(json).toBeDefined()
    const result = parseManifest(JSON.parse(json!.text))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings).toEqual([])
  })

  it("l'exemple de réglages est accepté par le vrai validateur", () => {
    const json = blocks.find(
      (b): b is Extract<Block, { type: 'code' }> =>
        b.type === 'code' && b.lang === 'json' && b.text.trimStart().startsWith('"settings"')
    )
    expect(json).toBeDefined()
    const { settings } = JSON.parse(`{${json!.text}}`)
    const result = parseManifest({
      manifestVersion: 1,
      name: 'Test',
      version: '1.0.0',
      modules: [{ id: 'm', name: 'M', entry: 'm.html', size: { width: 10, height: 10 }, settings }]
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings).toEqual([])
  })

  it('les champs du manifeste cités dans les tableaux existent vraiment', () => {
    const documented = new Set<string>()
    for (const block of blocks) {
      if (block.type !== 'table') continue
      for (const row of block.rows) {
        const first = row[0]
        if (first?.length === 1 && first[0].type === 'code') documented.add(first[0].text)
      }
    }
    for (const field of ['manifestVersion', 'defaultPosition', 'data', 'settings', 'category']) {
      expect(documented.has(field), field).toBe(true)
    }
  })
})

describe('les deux versions du guide', () => {
  const outline = (file: string): string[] =>
    parseMarkdown(readFileSync(join(process.cwd(), 'docs', file), 'utf8')).map((block) => {
      if (block.type === 'heading') return 'h' + block.level
      if (block.type === 'code') return 'code:' + block.lang
      if (block.type === 'table') return `table:${block.header.length}x${block.rows.length}`
      if (block.type === 'list') return `list:${block.items.length}`
      return block.type
    })

  it('ont la même structure : mêmes titres, blocs de code, tableaux et listes', () => {
    expect(outline('overlay-guide.fr.md')).toEqual(outline('overlay-guide.md'))
  })

  it('ont les mêmes blocs de code JSON et JavaScript (le code ne se traduit pas)', () => {
    const jsonBlocks = (file: string): string[] =>
      parseMarkdown(readFileSync(join(process.cwd(), 'docs', file), 'utf8'))
        .filter(
          (b): b is Extract<Block, { type: 'code' }> => b.type === 'code' && b.lang === 'json'
        )
        .map((b) => b.text.replace(/"(name|label|description)": "[^"]*"/g, '"$1": "_"'))
    expect(jsonBlocks('overlay-guide.fr.md')).toEqual(jsonBlocks('overlay-guide.md'))
  })
})
