import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 文字起こしの本文を直す UI の見た目のうち、崩れてもテストが全部通ってしまう部分を固定する。
 *
 * 守るのは「直すペンが本文の末尾にあり、読む邪魔をしないこと」と「編集欄が本文の桁に収まり、
 * 長い発言でも全文が見えること」。
 */
const css = readFileSync(join(process.cwd(), 'src/renderer/styles.css'), 'utf8')

/** セレクタに対応する宣言ブロックの中身を取り出す。 */
const ruleFor = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(^|\\})[^{}]*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  if (!match?.[2]) throw new Error(`styles.css に ${selector} のルールが見つかりません。`)
  return match[2]
}

describe('本文を直すボタン', () => {
  it('ふだんは隠しておく（全行に並ぶと本文が読みにくい）', () => {
    expect(ruleFor('.segment__edit')).toMatch(/opacity:\s*0\s*;/)
  })

  it('押せないときは行に触れても薄く見せるだけにする（押せるように見せない）', () => {
    expect(ruleFor('.segment:hover .segment__edit:disabled')).toMatch(/opacity:\s*0\.\d+/)
  })

  it('行にマウスを載せたときとキーボードで辿り着いたときに見せる', () => {
    expect(ruleFor('.segment:hover .segment__edit')).toMatch(/opacity:\s*1/)
    expect(ruleFor('.segment__edit:focus-visible')).toMatch(/opacity:\s*1/)
  })

  it('本文の末尾に続けて置き、右端の固定幅を取らない', () => {
    expect(ruleFor('.segment__body')).not.toMatch(/display:\s*flex/)
    expect(ruleFor('.segment__edit')).toMatch(/display:\s*inline/)
  })

  it('末尾の文字と一緒に折り返す（ペンだけが次の行に落ちない）', () => {
    expect(ruleFor('.segment__text-tail')).toMatch(/white-space:\s*nowrap/)
  })
})

describe('本文の編集欄', () => {
  it('本文の桁いっぱいに広げる', () => {
    expect(ruleFor('.segment__text-input')).toMatch(/width:\s*100%/)
  })

  it('発言の長さに合わせて高さが伸びる（長い発言をスクロールさせずに見せる）', () => {
    expect(ruleFor('.segment__text-input')).toMatch(/field-sizing:\s*content/)
  })
})
