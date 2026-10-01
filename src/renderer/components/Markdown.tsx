import { Fragment, type ReactElement, type ReactNode } from 'react'
import { parseMarkdown, type Block, type Inline } from '../markdown/parse'

/**
 * Markdown を React 要素として描く。
 *
 * HTML 文字列を組み立てず木をそのまま要素に写すので `dangerouslySetInnerHTML` を使わず、
 * 要約に混ざった HTML が実行される余地が構造的に無い。リンクの安全性は
 * `parseMarkdown` が保証済み（安全なスキームのリンクしか木に載らない）。
 */
const renderInline = (nodes: readonly Inline[]): ReactNode =>
  nodes.map((node, index) => {
    const key = index
    switch (node.kind) {
      case 'text':
        return <Fragment key={key}>{node.text}</Fragment>
      case 'strong':
        return <strong key={key}>{renderInline(node.children)}</strong>
      case 'em':
        return <em key={key}>{renderInline(node.children)}</em>
      case 'strike':
        return <s key={key}>{renderInline(node.children)}</s>
      case 'code':
        return <code key={key}>{node.text}</code>
      case 'link':
        // 外部リンクは main の setWindowOpenHandler が既定ブラウザへ逃がす。
        return (
          <a key={key} href={node.href} target="_blank" rel="noreferrer">
            {renderInline(node.children)}
          </a>
        )
    }
  })

const renderBlocks = (blocks: readonly Block[]): ReactNode =>
  blocks.map((block, index) => {
    const key = index
    switch (block.kind) {
      case 'heading': {
        const Tag = `h${block.level}` as 'h1'
        return <Tag key={key}>{renderInline(block.children)}</Tag>
      }
      case 'paragraph':
        return <p key={key}>{renderInline(block.children)}</p>
      case 'rule':
        return <hr key={key} />
      case 'code':
        return (
          <pre key={key}>
            <code>{block.text}</code>
          </pre>
        )
      case 'list': {
        const items = block.items.map((item, at) => (
          <li key={at}>
            {renderInline(item.content)}
            {renderBlocks(item.nested)}
          </li>
        ))
        return block.ordered ? (
          <ol key={key} start={block.start}>
            {items}
          </ol>
        ) : (
          <ul key={key}>{items}</ul>
        )
      }
      case 'table':
        return (
          <table key={key}>
            <thead>
              <tr>
                {block.head.map((cell, at) => (
                  <th key={at} style={styleFor(block.align[at])}>
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowAt) => (
                <tr key={rowAt}>
                  {row.map((cell, at) => (
                    <td key={at} style={styleFor(block.align[at])}>
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )
    }
  })

/** 表の寄せ指定。列ごとに変わるため CSS ではなくインラインで当てる。 */
const styleFor = (
  align: 'left' | 'center' | 'right' | null | undefined
): { textAlign?: 'left' | 'center' | 'right' } => (align ? { textAlign: align } : {})

export const Markdown = ({ source }: { source: string }): ReactElement => <>{renderBlocks(parseMarkdown(source))}</>
