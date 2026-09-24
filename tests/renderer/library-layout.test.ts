import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ライブラリ画面が「ツリー＋詳細」の 2 カラムであり、ツリーの録音行が
 * 決まった 2 行（タイトル／日時と長さ）に収まることを守る。横幅が狭くて読めないのを解消するための構成なので、
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

  it('録音行の 1 行目はタイトルとステータスを横に並べる', () => {
    const rule = ruleFor('.tree__item-line')

    expect(rule).toMatch(/display:\s*flex/)
    expect(rule).toMatch(/align-items:\s*center/)
  })

  it('2 行目の日時と長さも折り返さず省略する（行の高さを揃える）', () => {
    const rule = ruleFor('.tree__meta')

    expect(rule).toMatch(/white-space:\s*nowrap/)
    expect(rule).toMatch(/text-overflow:\s*ellipsis/)
  })

  it('長いタイトルは折り返さず省略する', () => {
    const rule = ruleFor('.tree__title')

    expect(rule).toMatch(/white-space:\s*nowrap/)
    expect(rule).toMatch(/overflow:\s*hidden/)
    expect(rule).toMatch(/text-overflow:\s*ellipsis/)
  })
})

/**
 * 取り込みのオーバーレイは、見た目を確かめる手段が単体テストに無い。
 * 「ドロップを奪わない」「モーダルより下」という壊れると分かりにくい 2 点を宣言で固定する。
 */
/**
 * 長いフォルダ名でボタンが 1 行を占め、段が無駄に増えないよう、幅を決めて省略する。
 * 全文は title 属性（ホバー）で読める。
 */
describe('フォルダのボタン', () => {
  it('長い名前は決まった幅で省略する', () => {
    const rule = ruleFor('.folder-chip__name')

    expect(rule).toMatch(/max-width:\s*\d+(em|px)/)
    expect(rule).toMatch(/white-space:\s*nowrap/)
    expect(rule).toMatch(/text-overflow:\s*ellipsis/)
  })
})

describe('ドロップ中のオーバーレイ', () => {
  it('画面全体を覆う', () => {
    const rule = ruleFor('.drop-overlay')

    expect(rule).toMatch(/position:\s*fixed/)
    expect(rule).toMatch(/inset:\s*0/)
  })

  it('ドロップ自体は奪わない', () => {
    // pointer-events を切らないと、被せた要素が drop を受けてファイルが取り込めない。
    expect(ruleFor('.drop-overlay')).toMatch(/pointer-events:\s*none/)
  })

  it('モーダルより下に重なる', () => {
    const overlay = Number(/z-index:\s*(\d+)/.exec(ruleFor('.drop-overlay'))?.[1])
    const modal = Number(/z-index:\s*(\d+)/.exec(ruleFor('.modal-backdrop'))?.[1])

    expect(overlay).toBeLessThan(modal)
  })

  it('知らせを出している間だけ行を 2 段にする', () => {
    // 常に 2 段にすると、知らせが無いときに空の行が残って本体の高さが足りなくなる。
    expect(ruleFor('.library--notified')).toMatch(/grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/)
  })
})
