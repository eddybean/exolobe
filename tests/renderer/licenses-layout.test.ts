import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ライセンス表記のうち、崩れてもテストが全部通ってしまう部分を宣言ごと固定する。
 *
 * 表記は設定画面の「このアプリについて」にそのまま出す。以前はモーダルで、中で
 * スクロールさせていたが、専用のページができたのでページごとスクロールすればよい。
 * 内側にもスクロールを持たせると、全文を読むときにスクロールが二重になる。
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

describe('ライセンス表記', () => {
  it('内側ではスクロールさせず、ページごと流す（スクロールを二重にしない）', () => {
    const rule = ruleFor('.licenses__body')

    expect(rule).not.toMatch(/max-height:/)
    expect(rule).not.toMatch(/overflow-y:\s*auto/)
  })

  it('ライセンス全文は改行を保ったまま折り返す', () => {
    const rule = ruleFor('.licenses__text')

    // 全文は整形済みのプレーンテキスト。改行を潰すと条項の区切りが消える。
    expect(rule).toMatch(/white-space:\s*pre-wrap/)
    // 折り返さないと URL や長い行がはみ出して横スクロールが生まれる。
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('著作権表示も原文の改行を保つ（Electron のように 2 行のものがある）', () => {
    expect(ruleFor('.licenses__copyright')).toMatch(/white-space:\s*pre-line/)
  })
})
