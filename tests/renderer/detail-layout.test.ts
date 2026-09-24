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
 * 処理状況はステップを縦に並べ、失敗の全文をそのステップの直下に常に出す。
 *
 * 以前は横並びのバッヂにホバーすると全文が出る作りで、マウスを外すと消え、
 * 読む・コピーする前に見失っていた。重ねて出すこともできない —— 親の .detail が
 * overflow: hidden で切るため、画面外に消える。レイアウト結果は単体テストで
 * 測れないので、宣言そのものを固定する。
 */
describe('処理状況', () => {
  it('ステップを縦に積む', () => {
    expect(ruleFor('.pipeline__steps')).toMatch(/flex-direction:\s*column/)
  })

  it('失敗の全文を重ねて出さない（親の overflow: hidden に切られるため）', () => {
    expect(ruleFor('.detail')).toMatch(/overflow:\s*hidden/)
    expect(ruleFor('.pipeline__failure')).not.toMatch(/position:\s*(absolute|fixed)/)
  })

  it('失敗の全文を折り返して読ませる', () => {
    expect(ruleFor('.pipeline__failure')).toMatch(/white-space:\s*pre-wrap/)
  })

  it('失敗の文言を選択してコピーできる', () => {
    // ネイティブ由来の英語エラーは検索・報告に持ち出したくなる。
    expect(ruleFor('.pipeline__failure')).toMatch(/user-select:\s*text/)
  })
})
