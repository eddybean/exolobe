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

/**
 * セレクタがちょうどそれだけのルールを取り出す。前方一致で `.timeline__labels, …` の
 * 複合ルールを拾わないため。
 */
const exactRuleFor = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  if (!match?.[2]) throw new Error(`styles.css に ${selector} だけのルールが見つかりません。`)
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
  it('音声ができるまでは無効に見せ、帯を押せなくする（再生と同じ扱い）', () => {
    expect(ruleFor('.timeline--disabled')).toMatch(/opacity:\s*0\.\d+/)
    expect(ruleFor('.timeline--disabled .timeline__track')).toMatch(/pointer-events:\s*none/)
  })

  it('無効な間もスクロールはできる（音声を待つ間も、隠れた段の話者を見られる）', () => {
    expect(ruleFor('.timeline--disabled')).not.toMatch(/pointer-events:\s*none/)
  })

  it('参加者が多くても高さは 4 人分ほどで止め、それ以上は枠の中でスクロールする', () => {
    // 伸ばし続けると、下の文字起こしと要約の欄が押し下げられて読めなくなる。
    const rule = ruleFor('.timeline')

    expect(rule).toMatch(/max-height:\s*calc\(var\(--lane-height\)\s*\*\s*4\.5/)
    expect(rule).toMatch(/overflow-y:\s*auto/)
  })

  it('話者名と帯は同じ高さの段に並ぶ（スクロールしても名前と帯がずれない）', () => {
    expect(exactRuleFor('.timeline__label')).toMatch(/height:\s*var\(--lane-height\)/)
    expect(exactRuleFor('.timeline__track')).toMatch(/height:\s*var\(--lane-height\)/)
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

/** 再生の操作。値が変わるたびに隣の要素が左右に揺れないようにする。 */
describe('再生の操作', () => {
  it('再生位置の数字は等幅にする（再生中に「/ 全長」が揺れない）', () => {
    expect(ruleFor('.player-controls__time')).toMatch(/font-variant-numeric:\s*tabular-nums/)
  })

  it('速度のボタンは最小幅を持つ（1× と 1.25× で幅が変わらない）', () => {
    expect(ruleFor('.player-controls__rate')).toMatch(/min-width:\s*[\d.]+(em|px)/)
  })

  it('音量は右端に寄せる（再生・時刻・速度をまとめて左に置き、音量は離して誤操作を避ける）', () => {
    expect(ruleFor('.player-controls__volume')).toMatch(/margin-left:\s*auto/)
  })

  it('音量のスライダーは幅を抑える', () => {
    expect(ruleFor('.player-controls__volume-slider')).toMatch(/width:\s*\d+px/)
  })
})
