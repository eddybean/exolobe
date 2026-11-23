import { describe, expect, it } from 'vitest'
import {
  applyCaptionEvent,
  captionLines,
  initialLiveCaption,
  type CaptionEvent,
  type LiveCaptionState
} from '@domain/LiveCaption'

const apply = (events: readonly CaptionEvent[], limits?: Parameters<typeof applyCaptionEvent>[2]) =>
  events.reduce<LiveCaptionState>((state, event) => applyCaptionEvent(state, event, limits), initialLiveCaption())

const volatile = (track: CaptionEvent['track'], text: string, startMs: number, endMs: number): CaptionEvent => ({
  track,
  kind: 'volatile',
  text,
  startMs,
  endMs
})

const final = (track: CaptionEvent['track'], text: string, startMs: number, endMs: number): CaptionEvent => ({
  track,
  kind: 'final',
  text,
  startMs,
  endMs
})

describe('applyCaptionEvent', () => {
  it('書きかけの行はトラックごとに 1 行だけ持ち、新しいもので置き換える', () => {
    const state = apply([volatile('remote', 'それでは', 0, 800), volatile('remote', 'それでは定例を', 0, 1_600)])

    expect(captionLines(state)).toEqual([
      { track: 'remote', text: 'それでは定例を', startMs: 0, endMs: 1_600, pending: true }
    ])
  })

  it('確定した行が来たら、その範囲の書きかけを消す', () => {
    const state = apply([
      volatile('remote', 'それでは定例を', 0, 1_600),
      final('remote', 'それでは定例を始めます。', 0, 2_000)
    ])

    expect(captionLines(state)).toEqual([
      { track: 'remote', text: 'それでは定例を始めます。', startMs: 0, endMs: 2_000, pending: false }
    ])
  })

  it('確定した範囲より後から始まる書きかけは残す', () => {
    const state = apply([
      volatile('remote', '始めます。まず', 0, 2_600),
      volatile('remote', 'まず先週', 2_100, 3_000),
      final('remote', '始めます。', 0, 2_000)
    ])

    expect(captionLines(state).map((line) => [line.text, line.pending])).toEqual([
      ['始めます。', false],
      ['まず先週', true]
    ])
  })

  it('もう一方のトラックの書きかけには触れない', () => {
    const state = apply([
      volatile('self', '了解です', 500, 1_200),
      volatile('remote', 'それでは', 0, 800),
      final('remote', 'それでは。', 0, 1_000)
    ])

    expect(captionLines(state).map((line) => [line.track, line.text, line.pending])).toEqual([
      ['remote', 'それでは。', false],
      ['self', '了解です', true]
    ])
  })

  it('2 トラックの行は話し始めた時刻の順に並べる', () => {
    const state = apply([
      final('self', '了解です。', 2_500, 3_000),
      final('remote', 'それでは。', 0, 1_000),
      final('remote', '次に。', 4_000, 5_000)
    ])

    expect(captionLines(state).map((line) => line.text)).toEqual(['それでは。', '了解です。', '次に。'])
  })

  it('空の確定は行を足さず、範囲の書きかけだけを消す', () => {
    const state = apply([volatile('remote', 'えー', 0, 500), final('remote', '  ', 0, 600)])

    expect(captionLines(state)).toEqual([])
  })

  it('確定した行は上限を超えたら古い方から捨てる', () => {
    const events = Array.from({ length: 5 }, (_, index) =>
      final('remote', `発言${index}`, index * 1_000, index * 1_000 + 500)
    )
    const state = apply(events, { maxLines: 3, maxChars: 100 })

    expect(captionLines(state).map((line) => line.text)).toEqual(['発言2', '発言3', '発言4'])
  })

  it('長すぎる行は末尾（最新の語）を残して切り詰め、切ったことを印で示す', () => {
    const state = apply([volatile('remote', 'あいうえおかきくけこ', 0, 5_000)], {
      maxLines: 10,
      maxChars: 4
    })

    expect(captionLines(state)).toEqual([
      { track: 'remote', text: 'きくけこ', startMs: 0, endMs: 5_000, pending: true, clipped: true }
    ])
  })
})
