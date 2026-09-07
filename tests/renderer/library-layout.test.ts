import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ライブラリ画面が「ツリー＋詳細」の 2 カラムであり、ツリーの録音行が
 * 1 行に収まることを守る。横幅が狭くて読めないのを解消するための構成なので、
 * 3 カラムに戻したり録音行を折り返させたりすると目的を失う。
 * ブラウザのレイアウト結果は単体テストでは測れないため、宣言そのものを固定する。
 */
const css = readFileSync(join(process.cwd(), 'src/renderer/styles.css'), 'utf8')

const ruleFor = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(^|\\})[^{}]*${escaped}[^{}]*\\{([^}]*)\\}`, 'm'))
  if (!match?.[2]) throw new Error(`styles.css に ${selector} のルールが見つかりません。`)
  return match[2]
}

describe('ライブラリ画面の構成', () => {
  it('ツリーと詳細の 2 カラムである', () => {
    expect(ruleFor('.library')).toMatch(/grid-template-columns:\s*\d+px\s+1fr\s*;/)
  })

  it('録音行はタイトルとステータスを横に並べた 1 行である', () => {
    const rule = ruleFor('.tree__item')

    expect(rule).toMatch(/display:\s*flex/)
    expect(rule).toMatch(/align-items:\s*center/)
  })

  it('長いタイトルは折り返さず省略する', () => {
    const rule = ruleFor('.tree__title')

    expect(rule).toMatch(/white-space:\s*nowrap/)
    expect(rule).toMatch(/overflow:\s*hidden/)
    expect(rule).toMatch(/text-overflow:\s*ellipsis/)
  })
})
