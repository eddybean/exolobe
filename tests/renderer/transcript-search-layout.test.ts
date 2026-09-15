import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 本文の検索の見た目のうち、崩れてもテストが全部通ってしまう部分を宣言ごと固定する。
 *
 * ブラウザのレイアウト結果は単体テストでは測れないので、ここで守るのは
 * 「当たった語が見えること」と「飛んだ先の発言が桁をずらさずに目立つこと」の 2 点。
 */
const css = readFileSync(join(process.cwd(), 'src/renderer/styles.css'), 'utf8')

/** セレクタに対応する宣言ブロックの中身を取り出す。 */
const ruleFor = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(^|\\})[^{}]*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  if (!match?.[2]) throw new Error(`styles.css に ${selector} のルールが見つかりません。`)
  return match[2]
}

describe('本文の検索結果', () => {
  it('当たった語を色と太さで示す（既定の黄色い背景のままにしない）', () => {
    const rule = ruleFor('.transcript-hit__excerpt mark')

    expect(rule).toMatch(/background:\s*transparent/)
    expect(rule).toMatch(/color:\s*var\(--accent\)/)
  })

  it('抜粋は 2 行で打ち切る（長い発言が一覧を押し流さない）', () => {
    expect(ruleFor('.transcript-hit__excerpt')).toMatch(/-webkit-line-clamp:\s*2/)
  })

  it('結果が増えても一覧の中でスクロールする', () => {
    expect(ruleFor('.transcript-hits')).toMatch(/overflow-y:\s*auto/)
  })
})

describe('飛んだ先の発言の印', () => {
  it('背景で示す', () => {
    expect(ruleFor('.segment--focused')).toMatch(/background:\s*var\(--surface-2\)/)
  })

  it('桁をずらす指定を持たない（時刻・話者・本文の縦の線をこの行だけ動かさない）', () => {
    const rule = ruleFor('.segment--focused')

    // border-radius は角を丸めるだけで桁を動かさないので、ここでは咎めない。
    expect(rule).not.toMatch(/(^|;)\s*(border(?!-radius)|padding|margin)(-[a-z]+)?\s*:/)
  })
})
