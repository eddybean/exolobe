import { describe, expect, it } from 'vitest'

import { focusedSegmentIndex, splitHighlight } from '@renderer/library/transcriptSearch'

const segments = [
  { startMs: 0, endMs: 1_000, speakerId: 'self', text: 'おはよう' },
  { startMs: 5_000, endMs: 8_000, speakerId: 'remote', text: '予算の話' },
  { startMs: 8_000, endMs: 9_000, speakerId: 'self', text: 'はい' }
]

describe('splitHighlight', () => {
  it('ハイライトする範囲で区切る', () => {
    expect(splitHighlight('今日は雨が降る', [{ start: 3, length: 1 }])).toEqual([
      { text: '今日は', hit: false },
      { text: '雨', hit: true },
      { text: 'が降る', hit: false }
    ])
  })

  it('範囲が無ければ 1 つのまま返す', () => {
    expect(splitHighlight('予算の話', [])).toEqual([{ text: '予算の話', hit: false }])
  })

  it('先頭と末尾に接する範囲で空の断片を作らない', () => {
    expect(splitHighlight('予算', [{ start: 0, length: 2 }])).toEqual([
      { text: '予算', hit: true }
    ])
  })

  it('重なった範囲は 1 つにまとめる（語どうしが重なっても断片が壊れない）', () => {
    expect(
      splitHighlight('来期の予算案', [
        { start: 3, length: 2 },
        { start: 4, length: 2 }
      ])
    ).toEqual([
      { text: '来期の', hit: false },
      { text: '予算案', hit: true }
    ])
  })
})

describe('focusedSegmentIndex', () => {
  it('開始時刻が一致する発言を指す', () => {
    expect(focusedSegmentIndex(segments, 5_000)).toBe(1)
  })

  it('一致しなければ、その時刻を含む手前の発言を指す（名前の変更で境目がずれても迷子にしない）', () => {
    expect(focusedSegmentIndex(segments, 6_200)).toBe(1)
  })

  it('どの発言より前なら先頭を指す', () => {
    expect(focusedSegmentIndex(segments, -1)).toBe(0)
  })

  it('発言が無ければ指す先が無い', () => {
    expect(focusedSegmentIndex([], 0)).toBe(-1)
  })
})
