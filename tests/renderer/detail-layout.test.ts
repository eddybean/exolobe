import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 詳細画面で、左（文字起こし）と右（要約・メモ）のパネル上端が揃っていることを守る。
 *
 * 左右はそれぞれ「1 行目 = プレーヤー／タブ、2 行目 = パネル」という同じ構造だが、
 * 列ごとに独立した縦並びにすると 1 行目の高さがそれぞれの中身で決まるため、
 * 2 行目のパネルの上端がずれる。これを親グリッドの行を共有する（subgrid）ことで
 * 構造的に揃える。ブラウザのレイアウト結果は単体テストでは測れないので、
 * 崩す変更に気付けるよう宣言そのものを固定する。
 */
const css = readFileSync(join(process.cwd(), 'src/renderer/styles.css'), 'utf8')

/** セレクタに対応する宣言ブロックの中身を取り出す。 */
const ruleFor = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(^|\\})[^{}]*${escaped}[^{}]*\\{([^}]*)\\}`, 'm'))
  if (!match?.[2]) throw new Error(`styles.css に ${selector} のルールが見つかりません。`)
  return match[2]
}

describe('詳細画面の左右カラム', () => {
  it('本体は 2 行（ツールバー行とパネル行）のグリッドである', () => {
    expect(ruleFor('.detail__body')).toMatch(/grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/)
  })

  it('左右の列が親の行を共有し、パネルの上端が揃う', () => {
    const rule = ruleFor('.detail__left')

    expect(rule).toMatch(/grid-template-rows:\s*subgrid/)
    // 2 行ぶんに跨がせないと行を共有できない。
    expect(rule).toMatch(/grid-row:\s*1\s*\/\s*-1/)
  })

  it('タブは高さの揃った行の中で縦中央に置く', () => {
    // プレーヤーの方が背が高いため、行の高さはプレーヤーで決まる。
    // 既定の stretch のままだとタブの背景が行いっぱいに伸びてしまう。
    expect(ruleFor('.tabs')).toMatch(/align-items:\s*center/)
  })
})

/**
 * 要約ペインは Markdown を描くようになったが、パネルの中で収まるという性質は変わらない。
 * ブラウザのレイアウト結果は単体テストで測れないので、崩す変更に気付けるよう宣言を固定する。
 */
describe('要約ペインの Markdown 表示', () => {
  it('要約はパネルの中でスクロールする', () => {
    expect(ruleFor('.summary')).toMatch(/overflow:\s*auto/)
  })

  it('段落内の改行を残す（要約の意味の区切りが潰れない）', () => {
    // かつて .summary 自身が pre-wrap だった。Markdown 化で段落へ移した。
    expect(ruleFor('.summary p')).toMatch(/white-space:\s*pre-wrap/)
  })

  it('コードブロックはパネルを横に押し広げず、自身の中で横スクロールする', () => {
    expect(ruleFor('.summary pre')).toMatch(/overflow-x:\s*auto/)
  })
})

/**
 * ステップバッヂは「どのステップがどうなったか」の一覧。エラー文言を中に描くと
 * バッヂ列が横に伸びて一覧性が壊れ、しかも省略されて全文は読めなかった。
 * 文言はツールチップとコピーへ移したので、バッヂが伸びないことを宣言で固定する。
 */
describe('ステップバッヂ', () => {
  it('バッヂの中で折り返して肥大化しない', () => {
    expect(ruleFor('.steps__item')).toMatch(/white-space:\s*nowrap/)
  })

  it('エラー文言をバッヂ内に描くルールを持たない', () => {
    expect(() => ruleFor('.steps__error')).toThrow()
  })
})

/**
 * 失敗の全文はバッヂ列の下、通常のフローに出す。
 *
 * 重ねて出すことはできない —— 親の .detail が overflow: hidden で切るため、
 * ネイティブの title 属性も含めて画面外に消える（実際それで見えていなかった）。
 * ブラウザのレイアウト結果は単体テストで測れないので、宣言そのものを固定する。
 */
describe('ステップの失敗の全文', () => {
  it('重ねて出さない（親の overflow: hidden に切られるため）', () => {
    expect(ruleFor('.detail')).toMatch(/overflow:\s*hidden/)
    expect(ruleFor('.steps__detail')).not.toMatch(/position:\s*(absolute|fixed)/)
  })

  it('バッヂ列の下に積む', () => {
    expect(ruleFor('.steps-block')).toMatch(/flex-direction:\s*column/)
  })

  it('全文を折り返して読ませる（バッヂの nowrap を持ち込まない）', () => {
    expect(ruleFor('.steps__detail')).toMatch(/white-space:\s*pre-wrap/)
  })

  it('文言を選択してコピーできる', () => {
    // ネイティブ由来の英語エラーは検索・報告に持ち出したくなる。
    expect(ruleFor('.steps__detail')).toMatch(/user-select:\s*text/)
  })
})
