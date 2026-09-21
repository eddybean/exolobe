import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ライセンス表記モーダルのうち、崩れてもテストが全部通ってしまう部分を宣言ごと固定する。
 *
 * ここに載るのは一覧と全文（Apache-2.0 だけで 1 万字を超える）なので、
 * 中でスクロールしなければモーダルが画面を突き抜けて「閉じる」に手が届かなくなる。
 * 全文は整形済みのテキストで、改行が潰れると条項の区切りが読めなくなる。
 */
const css = readFileSync(join(process.cwd(), 'src/renderer/styles.css'), 'utf8')

/** セレクタに対応する宣言ブロックの中身を取り出す。 */
const ruleFor = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(^|\\})[^{}]*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  if (!match?.[2]) throw new Error(`styles.css に ${selector} のルールが見つかりません。`)
  return match[2]
}

describe('ライセンス表記モーダル', () => {
  it('項目と全文が増えてもモーダルごと伸びない（中でスクロールする）', () => {
    const rule = ruleFor('.licenses__body')

    expect(rule).toMatch(/max-height:/)
    expect(rule).toMatch(/overflow-y:\s*auto/)
  })

  it('ライセンス全文は改行を保ったまま折り返す', () => {
    const rule = ruleFor('.licenses__text')

    // 全文は整形済みのプレーンテキスト。改行を潰すと条項の区切りが消える。
    expect(rule).toMatch(/white-space:\s*pre-wrap/)
    // 折り返さないと URL や長い行がモーダルの外へ出て横スクロールが生まれる。
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('著作権表示も原文の改行を保つ（Electron のように 2 行のものがある）', () => {
    expect(ruleFor('.licenses__copyright')).toMatch(/white-space:\s*pre-line/)
  })
})
