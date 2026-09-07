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
