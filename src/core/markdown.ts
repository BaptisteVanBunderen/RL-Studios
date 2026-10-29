/**
 * Markdown minimal, juste ce qu'il faut pour afficher le guide de création d'overlay dans le
 * client (`docs/overlay-guide.md`) sans ajouter de dépendance. Pur : texte en entrée, blocs en
 * sortie ; le client les dessine avec des éléments React (jamais de HTML brut injecté).
 *
 * Pris en charge : titres `#` à `###`, paragraphes, listes `-` et `1.`, blocs de code ``` avec
 * langage, tableaux `| a | b |`, citations `>`, `code` et **gras** dans le texte.
 * Un test lit le vrai guide pour vérifier qu'il n'utilise rien d'autre.
 */

export type Inline =
  { type: 'text'; text: string } | { type: 'code'; text: string } | { type: 'bold'; text: string }

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'quote'; inlines: Inline[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*)/

/** Découpe une ligne de texte en morceaux de texte, de `code` et de **gras**. */
export function parseInlines(text: string): Inline[] {
  const out: Inline[] = []
  for (const part of text.split(INLINE)) {
    if (part === '') continue
    if (part.startsWith('`')) out.push({ type: 'code', text: part.slice(1, -1) })
    else if (part.startsWith('**')) out.push({ type: 'bold', text: part.slice(2, -2) })
    else out.push({ type: 'text', text: part })
  }
  return out
}

const HEADING = /^(#{1,3})\s+(.*)$/
const BULLET = /^-\s+(.*)$/
const NUMBERED = /^(\d+)\.\s+(.*)$/
const FENCE = /^```(\w*)\s*$/
const TABLE_ROW = /^\|.*\|\s*$/
const TABLE_SEPARATOR = /^\|[\s:|-]+\|\s*$/

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function startsBlock(line: string): boolean {
  return (
    HEADING.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    FENCE.test(line) ||
    TABLE_ROW.test(line) ||
    line.startsWith('>')
  )
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++])
      i++ // la clôture
      blocks.push({ type: 'code', lang: fence[1], text: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        inlines: parseInlines(heading[2])
      })
      i++
      continue
    }

    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
      const header = splitRow(line).map(parseInlines)
      i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        rows.push(splitRow(lines[i++]).map(parseInlines))
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }

    if (line.startsWith('>')) {
      const quoted: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) {
        quoted.push(lines[i++].replace(/^>\s?/, ''))
      }
      blocks.push({ type: 'quote', inlines: parseInlines(quoted.join(' ')) })
      continue
    }

    const bullet = BULLET.exec(line)
    const numbered = NUMBERED.exec(line)
    if (bullet || numbered) {
      const ordered = numbered !== null
      const start = numbered ? Number(numbered[1]) : 1
      const items: Inline[][] = []
      while (i < lines.length) {
        const match = (ordered ? NUMBERED : BULLET).exec(lines[i])
        if (!match) break
        items.push(parseInlines(match[ordered ? 2 : 1]))
        i++
      }
      blocks.push({ type: 'list', ordered, start, items })
      continue
    }

    // Paragraphe : les lignes qui se suivent forment un seul bloc de texte. La première est
    // toujours prise (même si elle ressemble à un début de bloc incomplet) : la boucle avance.
    const text: string[] = [line.trim()]
    i++
    while (i < lines.length && lines[i].trim() !== '' && !startsBlock(lines[i])) {
      text.push(lines[i++].trim())
    }
    blocks.push({ type: 'paragraph', inlines: parseInlines(text.join(' ')) })
  }

  return blocks
}
