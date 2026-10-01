import { describe, expect, it } from 'vitest'
import { characterErrorRate, hallucinatedChars, longestRepeatRun, missedUtterances } from './metrics'

const at = (startS: number, endS: number, text: string) => ({
  startMs: startS * 1000,
  endMs: endS * 1000,
  text
})

describe('characterErrorRate', () => {
  it('句読点と空白を除き、編集距離を正解の文字数で割る', () => {
    // 「回収」→「改修」の 2 文字置換。正解は句読点を除いて 11 文字。
    expect(characterErrorRate('ログイン画面の改修です。', 'ログイン 画面の回収です')).toBeCloseTo(2 / 11)
  })

  it('全角と半角の違いは誤りに数えない', () => {
    expect(characterErrorRate('あと２日です', 'あと2日です')).toBe(0)
  })

  it('繰り返しで膨らんだ出力は 1 を超える', () => {
    expect(characterErrorRate('はい', 'はいはいはい')).toBe(2)
  })
})

describe('hallucinatedChars', () => {
  const said = [at(0, 5, 'それでは始めます'), at(20, 25, '了解です')]

  it('発話の無い区間に出たセグメントの文字数を数える', () => {
    const output = [at(0, 5, 'それでは始めます。'), at(8, 18, 'ご視聴ありがとうございました'), at(20, 25, '了解です')]

    expect(hallucinatedChars(said, output)).toBe(14)
  })

  it('発話の端から少しずれただけのセグメントは数えない', () => {
    // whisper の時刻は発話の端から数百ミリ秒ずれる。
    expect(hallucinatedChars(said, [at(5.3, 6, 'です')])).toBe(0)
  })
})

describe('missedUtterances', () => {
  const said = [at(0, 5, 'それでは始めます'), at(20, 25, '検索は時間がかかっています')]

  it('重なるセグメントに言葉が半分も残っていない発話を数える', () => {
    // 2 つ目はループに呑まれ、時刻は重なるが別の文になっている。
    const output = [at(0, 5, 'それでは始めます'), at(18, 30, '検索機能の回収を上げてください')]

    expect(missedUtterances(said, output)).toBe(1)
  })

  it('多少の誤りがあっても半分以上残っていれば拾えたとみなす', () => {
    const output = [at(0, 5, 'それでは始めます'), at(20, 25, '選択は時間がかかっています')]

    expect(missedUtterances(said, output)).toBe(0)
  })
})

describe('longestRepeatRun', () => {
  it('句読点の揺れを無視して、同じ文が続いた最長の数を返す', () => {
    const output = ['はい。', '検索機能です', '検索機能です。', '検索 機能です', '了解です'].map((text, i) =>
      at(i, i + 1, text)
    )

    expect(longestRepeatRun(output)).toBe(3)
  })

  it('出力が無ければ 0', () => {
    expect(longestRepeatRun([])).toBe(0)
  })
})
