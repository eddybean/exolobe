import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { SPEAKER_TONE_COUNT } from '@renderer/library/timeline'

/**
 * 話者の色とタイムラインの見た目の契約。ブラウザの描画結果は単体テストで測れないので、
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

/** 宣言ブロックから `--tone-N` の色を番号順に取り出す。 */
const tonesIn = (block: string): string[] =>
  Array.from({ length: SPEAKER_TONE_COUNT }, (_, index) => {
    const match = block.match(new RegExp(`--tone-${index}:\\s*(#[0-9a-fA-F]{6})`))
    if (!match?.[1]) throw new Error(`--tone-${index} が見つかりません。`)
    return match[1]
  })

/** WCAG の相対輝度。 */
const luminance = (hex: string): number => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5]
    .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => (value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (left: string, right: string): number => {
  const [light, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

/** 色覚によらず見分けられる目安にする明度の比。 */
const MIN_TONE_CONTRAST = 1.4

const lightTones = tonesIn(css.slice(css.indexOf(':root {'), css.indexOf('@media')))
const darkBlock = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'))
const darkTones = tonesIn(darkBlock.slice(0, darkBlock.indexOf('\n}\n')))

describe.each([
  ['ライト', lightTones],
  ['ダーク', darkTones]
])('話者の色（%s）', (_, tones) => {
  it('自分と相手 2 人（よくある会議）は、どの 2 人も明度で見分けられる', () => {
    const [self = '', first = '', second = ''] = tones

    expect(contrast(self, first)).toBeGreaterThanOrEqual(MIN_TONE_CONTRAST)
    expect(contrast(self, second)).toBeGreaterThanOrEqual(MIN_TONE_CONTRAST)
    expect(contrast(first, second)).toBeGreaterThanOrEqual(MIN_TONE_CONTRAST)
  })

  it('相手どうしは、隣り合う番号の色が明度で見分けられる', () => {
    for (let index = 1; index < tones.length - 1; index += 1) {
      expect(contrast(tones[index] ?? '', tones[index + 1] ?? '')).toBeGreaterThanOrEqual(
        MIN_TONE_CONTRAST
      )
    }
  })
})

describe('タイムライン', () => {
  it('音声ができるまでは無効に見せ、押せなくする（再生と同じ扱い）', () => {
    const rule = ruleFor('.timeline--disabled')

    expect(rule).toMatch(/opacity:\s*0\.\d+/)
    expect(rule).toMatch(/pointer-events:\s*none/)
  })

  it('短い発言の帯も消えない幅を持つ', () => {
    expect(ruleFor('.timeline__span')).toMatch(/min-width:\s*\d+px/)
  })
})

describe('再生中の発言', () => {
  it('背景だけを変え、時刻・話者・本文の桁を動かさない', () => {
    const rule = ruleFor('.segment--playing')

    expect(rule).toMatch(/background:/)
    // 角の丸めは寸法を変えないので許す。
    expect(rule).not.toMatch(/(^|\s)(border(?!-radius)|padding|margin)(-\w+)?:/)
  })
})
