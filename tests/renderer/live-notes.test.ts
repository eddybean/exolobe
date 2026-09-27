import { describe, expect, it } from 'vitest'
import { isBookmarkKey } from '@renderer/keyboard'
import {
  bookmarkedSegmentIndexes,
  detailMoments,
  litSegments,
  showsLiveView
} from '@renderer/library/liveNotes'
import { readTrackLevels } from '@renderer/session/readInputLevel'
import type { TranscriptSegment } from '@domain/TranscriptSegment'

describe('readTrackLevels', () => {
  it('相手（デスクトップ音声）と自分（マイク）を分けて返す', async () => {
    await expect(
      readTrackLevels({ micLevel: () => 0.2, systemLevel: async () => 0.7 })
    ).resolves.toEqual({ mic: 0.2, system: 0.7 })
  })

  it('マイクが取れていなければ mic は undefined（無音と区別して出す）', async () => {
    await expect(
      readTrackLevels({ micLevel: undefined, systemLevel: async () => 0.4 })
    ).resolves.toEqual({ mic: undefined, system: 0.4 })
  })

  it('デスクトップ音声を読めなければ無音として扱う', async () => {
    await expect(
      readTrackLevels({
        micLevel: () => 0.3,
        systemLevel: async () => {
          throw new Error('録音中ではありません。')
        }
      })
    ).resolves.toEqual({ mic: 0.3, system: 0 })
  })
})

describe('isBookmarkKey', () => {
  const key = {
    key: 'H',
    metaKey: true,
    shiftKey: true,
    ctrlKey: false,
    altKey: false,
    repeat: false,
    isComposing: false
  }

  it('⌘⇧H で印をつける（メモを書いている最中でも効く）', () => {
    expect(isBookmarkKey(key)).toBe(true)
    expect(isBookmarkKey({ ...key, key: 'h' })).toBe(true)
  })

  it('押しっぱなしの連打や、別の修飾キーとの組み合わせでは付けない', () => {
    expect(isBookmarkKey({ ...key, repeat: true })).toBe(false)
    expect(isBookmarkKey({ ...key, shiftKey: false })).toBe(false)
    expect(isBookmarkKey({ ...key, altKey: true })).toBe(false)
    expect(isBookmarkKey({ ...key, ctrlKey: true })).toBe(false)
  })

  it('日本語入力の変換中は付けない', () => {
    expect(isBookmarkKey({ ...key, isComposing: true })).toBe(false)
  })
})

describe('showsLiveView', () => {
  const recording = { id: 'rec-1', status: 'recording' as const }

  it('今録っている録音を開いたら録音中の画面にする', () => {
    expect(showsLiveView(recording, { active: true, recordingId: 'rec-1' })).toBe(true)
  })

  it('録音を止めたら、一覧の状態の更新を待たずに通常の詳細へ戻す', () => {
    expect(showsLiveView(recording, { active: false })).toBe(false)
  })

  it('落ちて「録音中」のまま残った録音は録音中の画面にしない', () => {
    expect(showsLiveView(recording, { active: true, recordingId: 'rec-2' })).toBe(false)
  })

  it('処理中の録音は通常の詳細', () => {
    expect(
      showsLiveView({ ...recording, status: 'processing' }, { active: true, recordingId: 'rec-1' })
    ).toBe(false)
  })
})

describe('detailMoments', () => {
  it('メモの時刻つきの行と印を、時刻順に並べる', () => {
    const note = ['- [00:03:10] エクスポート', '時刻なし', '- [00:00:05] 冒頭'].join('\n')

    expect(detailMoments(note, [{ atMs: 60_000 }])).toEqual([
      { kind: 'note', atMs: 5_000, text: '冒頭' },
      { kind: 'bookmark', atMs: 60_000, text: '' },
      { kind: 'note', atMs: 190_000, text: 'エクスポート' }
    ])
  })
})

describe('bookmarkedSegmentIndexes', () => {
  const segments: TranscriptSegment[] = [
    { startMs: 0, endMs: 4_000, speakerId: 'self', text: 'a' },
    { startMs: 5_000, endMs: 9_000, speakerId: 'remote', text: 'b' },
    { startMs: 10_000, endMs: 12_000, speakerId: 'self', text: 'c' }
  ]

  it('印を押した時点で話されていた発言を返す', () => {
    expect(bookmarkedSegmentIndexes(segments, [{ atMs: 6_000 }, { atMs: 11_000 }])).toEqual(
      new Set([1, 2])
    )
  })

  it('発言の合間に押した印は、直前の発言に付ける', () => {
    expect(bookmarkedSegmentIndexes(segments, [{ atMs: 9_500 }])).toEqual(new Set([1]))
  })

  it('文字起こしが無ければ空', () => {
    expect(bookmarkedSegmentIndexes([], [{ atMs: 1_000 }])).toEqual(new Set())
  })
})

describe('litSegments', () => {
  it('無音なら 1 つも点けない', () => {
    expect(litSegments(0, 12)).toBe(0)
  })

  it('話し声くらいの小さな peak でも半分近くまで振れる（線形だと目盛りの端で止まって見える）', () => {
    expect(litSegments(0.2, 12)).toBeGreaterThanOrEqual(5)
  })

  it('振り切れても段数を超えない', () => {
    expect(litSegments(1.5, 12)).toBe(12)
  })
})
