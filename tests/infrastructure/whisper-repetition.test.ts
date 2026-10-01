import { describe, expect, it } from 'vitest'
import { collapseRepeats, dropRepeatedSegments } from '@infrastructure/transcription/repetition'

/** 間を空けずに並べたセグメント。whisper のループは前の終わりから次が始まる。 */
const backToBack = (texts: readonly string[], startMs = 0, lengthMs = 2000) =>
  texts.map((text, i) => ({
    startMs: startMs + i * lengthMs,
    endMs: startMs + (i + 1) * lengthMs,
    text
  }))

describe('dropRepeatedSegments', () => {
  it('間を空けずに同じ文が続くループは最初の 1 つだけ残す', () => {
    const { kept, dropped } = dropRepeatedSegments([
      { startMs: 0, endMs: 5000, text: '検索は時間がかかっています。' },
      ...backToBack(Array<string>(6).fill('検索機能の回収を上げてください。'), 5000)
    ])

    expect(kept.map((s) => s.text)).toEqual(['検索は時間がかかっています。', '検索機能の回収を上げてください。'])
    expect(dropped).toHaveLength(5)
  })

  it('句読点の揺れだけなら同じ文として数える', () => {
    const { kept } = dropRepeatedSegments(
      backToBack(['はい、はい。', 'はいはい', 'はい、はい', 'はい。はい。', 'はいはい。'])
    )

    expect(kept.map((s) => s.text)).toEqual(['はい、はい。'])
  })

  it('3 回までの繰り返しは残す', () => {
    const texts = Array<string>(3).fill('はい、はい、そうですね、はい。')

    expect(dropRepeatedSegments(backToBack(texts)).kept).toHaveLength(3)
  })

  it('間を置いて同じ相づちが並ぶだけなら残す', () => {
    // マイクのトラックには相手の声が無いので、自分の「はい。」だけが並ぶ。
    const texts = Array<string>(6).fill('はい。')
    const spaced = texts.map((text, i) => ({ startMs: i * 5000, endMs: i * 5000 + 800, text }))

    expect(dropRepeatedSegments(spaced).kept).toHaveLength(6)
  })
})

describe('collapseRepeats', () => {
  it('同じ語句が延々と続くループを 1 回に縮め、削った部分を返す', () => {
    const loop = 'はい、'.repeat(10) + 'はい。'

    expect(collapseRepeats(loop)).toEqual({ text: 'はい、はい。', removed: 'はい、'.repeat(9) })
  })

  it('人が実際に言う程度の繰り返しには触れない', () => {
    // 合成音声で実際に読ませた相づち（3 回の繰り返し）と、よくある「はい」の連呼。
    for (const text of ['はいはいそうですねはいはいそうですねはいはいそうですねはい', 'はいはいはいはい']) {
      expect(collapseRepeats(text)).toEqual({ text, removed: '' })
    }
  })

  it('数字の桁は繰り返しとみなさない', () => {
    const text = '予算は100000000円です'

    expect(collapseRepeats(text)).toEqual({ text, removed: '' })
  })

  it('1 文まるごとのループも縮める', () => {
    const sentence = '検索機能の回収を上げてください。'

    expect(collapseRepeats(`了解です。${sentence.repeat(8)}`).text).toBe(`了解です。${sentence}`)
  })
})
