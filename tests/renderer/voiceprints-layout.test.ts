import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 覚えた声の一覧モーダルのうち、崩れてもテストが全部通ってしまう部分を宣言ごと固定する。
 *
 * この画面を作った理由は「人が増えると一覧が伸びて他の設定が遠ざかる」ことだった。
 * 高さの上限とその中でのスクロールが消えたら、モーダルに移しただけで元の問題が戻る。
 */
const css = readFileSync(join(process.cwd(), 'src/renderer/styles.css'), 'utf8')

/** セレクタに対応する宣言ブロックの中身を取り出す。 */
const ruleFor = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(^|\\})[^{}]*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  if (!match?.[2]) throw new Error(`styles.css に ${selector} のルールが見つかりません。`)
  return match[2]
}

describe('覚えた声の一覧モーダル', () => {
  it('人が増えても一覧の中でスクロールする（モーダルごと伸びない）', () => {
    const rule = ruleFor('.voiceprints--scroll')

    expect(rule).toMatch(/max-height:/)
    expect(rule).toMatch(/overflow-y:\s*auto/)
  })

  it('一覧に足りる幅を持ちつつ、狭いウィンドウでも画面からはみ出さない', () => {
    const rule = ruleFor('.modal--wide')

    // 320px 固定の .modal では「名前・学習の要約・忘れる」が 1 行に収まらない。
    expect(rule).toMatch(/width:\s*min\(/)
    expect(rule).toMatch(/100vw/)
  })

  it('「すべて忘れる」を「閉じる」から離す（押し間違いを避ける）', () => {
    expect(ruleFor('.modal__actions--split')).toMatch(/justify-content:\s*space-between/)
  })
})
