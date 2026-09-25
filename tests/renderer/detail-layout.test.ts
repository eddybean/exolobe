import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 詳細画面は、上に全幅の「舞台」（再生・話者帯、処理中は処理状況）、下に左右のパネルを置く。
 *
 * 以前は左列の 1 行目にプレーヤー、右列の 1 行目にタブを置き、subgrid で行を
 * 共有してパネルの上端を揃えていた。舞台を全幅に出したので、タブは右パネルの
 * 見出しに入れ、左右とも「パネル 1 枚」にして同じ行に並べる。ブラウザのレイアウト
 * 結果は単体テストでは測れないので、崩す変更に気付けるよう宣言そのものを固定する。
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
  it('左右のパネルは 1 行のグリッドに並び、上端が揃う', () => {
    const rule = ruleFor('.detail__body')

    expect(rule).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/)
    expect(rule).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\)/)
  })

  it('タブはパネルの見出しの中で縦中央に置く', () => {
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
 * 処理状況は舞台の中で、ステップの縦並びと残り時間の 2 列に分ける。
 * 全幅に 1 列で伸ばすと、ラベルと状態が画面の両端に離れて読みにくい。
 */
describe('処理状況', () => {
  it('ステップを縦に積む', () => {
    expect(ruleFor('.pipeline__steps')).toMatch(/flex-direction:\s*column/)
  })

  it('ステップの列は幅を抑え、残りを案内の列にする', () => {
    expect(ruleFor('.pipeline')).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*\d+px\)\s+minmax\(0,\s*1fr\)/
    )
  })
})

/**
 * 失敗は、そのステップが作るはずだったものの欄に全文で出す。
 *
 * 以前はバッヂにホバーすると全文が出る作りで、マウスを外すと消え、
 * 読む・コピーする前に見失っていた。重ねて出すこともできない —— 親の .detail が
 * overflow: hidden で切るため、画面外に消える。
 */
describe('失敗の表示', () => {
  it('失敗の全文を重ねて出さない（親の overflow: hidden に切られるため）', () => {
    expect(ruleFor('.detail')).toMatch(/overflow:\s*hidden/)
    expect(ruleFor('.failure__message')).not.toMatch(/position:\s*(absolute|fixed)/)
  })

  it('失敗の全文を折り返して読ませる', () => {
    expect(ruleFor('.failure__message')).toMatch(/white-space:\s*pre-wrap/)
  })

  it('失敗の文言を選択してコピーできる', () => {
    // ネイティブ由来の英語エラーは検索・報告に持ち出したくなる。
    expect(ruleFor('.failure__message')).toMatch(/user-select:\s*text/)
  })
})
