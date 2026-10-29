import { Fragment, useMemo } from 'react'
import { parseMarkdown, type Block, type Inline } from '@core/index'

function Inlines({ items }: { items: Inline[] }): React.JSX.Element {
  return (
    <>
      {items.map((item, i) => {
        if (item.type === 'code') {
          return (
            <code
              key={i}
              className="rounded bg-tag px-1.5 py-0.5 font-mono text-[0.85em] text-text"
            >
              {item.text}
            </code>
          )
        }
        if (item.type === 'bold') {
          return (
            <strong key={i} className="font-semibold text-text">
              {item.text}
            </strong>
          )
        }
        return <Fragment key={i}>{item.text}</Fragment>
      })}
    </>
  )
}

const HEADING_CLASS = {
  1: 'mb-4 text-3xl font-bold text-text',
  2: 'mt-10 mb-3 border-b border-line pb-2 text-xl font-bold text-text',
  3: 'mt-6 mb-2 text-base font-semibold text-text'
} as const

function BlockView({ block }: { block: Block }): React.JSX.Element {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${block.level}` as const
      return (
        <Tag className={HEADING_CLASS[block.level]}>
          <Inlines items={block.inlines} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p className="my-3 leading-relaxed text-sub">
          <Inlines items={block.inlines} />
        </p>
      )
    case 'quote':
      return (
        <blockquote className="my-4 rounded-r-xl border-l-4 border-accent bg-card px-4 py-3 text-sub">
          <Inlines items={block.inlines} />
        </blockquote>
      )
    case 'code':
      return (
        <pre className="my-4 overflow-x-auto rounded-xl border border-line bg-tile p-4 font-mono text-[13px] leading-relaxed text-text">
          <code>{block.text}</code>
        </pre>
      )
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag
          start={block.ordered ? block.start : undefined}
          className={`my-3 space-y-1.5 pl-6 text-sub ${block.ordered ? 'list-decimal' : 'list-disc'}`}
        >
          {block.items.map((item, i) => (
            <li key={i} className="pl-1 leading-relaxed">
              <Inlines items={item} />
            </li>
          ))}
        </Tag>
      )
    }
    case 'table':
      return (
        <div className="my-4 overflow-x-auto rounded-xl border border-line">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="bg-card">
                {block.header.map((cell, i) => (
                  <th key={i} className="px-3 py-2 font-semibold text-text">
                    <Inlines items={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-t border-line align-top">
                  {row.map((cell, c) => (
                    <td key={c} className="px-3 py-2 text-sub">
                      <Inlines items={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

/** Affiche un texte Markdown (le sous-ensemble de `@core/markdown`) avec le style du client. */
export function Markdown({ source }: { source: string }): React.JSX.Element {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  return (
    <article>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </article>
  )
}
