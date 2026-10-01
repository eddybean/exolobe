import { describe, expect, it } from 'vitest'
import { applyDiarization, coalesceSegments, formatTimestamp, mergeTracks, toMarkdown } from '@domain/Transcript'
import { REMOTE_SPEAKER_ID, SELF_SPEAKER_ID, type Speaker } from '@domain/Speaker'
import type { TranscriptSegment } from '@domain/TranscriptSegment'

const seg = (startMs: number, endMs: number, text: string, speakerId: string): TranscriptSegment => ({
  startMs,
  endMs,
  speakerId,
  text
})

describe('mergeTracks', () => {
  it('2 トラックのセグメントを開始時刻順に 1 本へまとめる', () => {
    const mic = [seg(0, 1000, 'おはようございます', SELF_SPEAKER_ID)]
    const system = [
      seg(1200, 2000, 'おはようございます', REMOTE_SPEAKER_ID),
      seg(2500, 3000, 'では始めます', REMOTE_SPEAKER_ID)
    ]

    expect(mergeTracks([mic, system]).map((s) => s.text)).toEqual([
      'おはようございます',
      'おはようございます',
      'では始めます'
    ])
  })

  it('開始時刻が同じ場合は終了時刻が早い方を先に置く', () => {
    const merged = mergeTracks([[seg(0, 5000, '長い', SELF_SPEAKER_ID)], [seg(0, 1000, '短い', REMOTE_SPEAKER_ID)]])
    expect(merged.map((s) => s.text)).toEqual(['短い', '長い'])
  })

  it('空トラックを渡しても壊れない', () => {
    expect(mergeTracks([[], []])).toEqual([])
  })
})

describe('applyDiarization', () => {
  const turns = [
    { startMs: 0, endMs: 2000, speaker: 'spk0' },
    { startMs: 2000, endMs: 4000, speaker: 'spk1' }
  ]

  it('相手トラックのセグメントを最も重なりの大きい話者へ割り当てる', () => {
    const segments = [seg(100, 1800, 'A の発言', REMOTE_SPEAKER_ID), seg(2100, 3900, 'B の発言', REMOTE_SPEAKER_ID)]

    expect(applyDiarization(segments, turns).map((s) => s.speakerId)).toEqual(['remote:spk0', 'remote:spk1'])
  })

  it('複数ターンにまたがる場合は重なりが最大の話者を選ぶ', () => {
    const segments = [seg(1500, 3800, 'またがる発言', REMOTE_SPEAKER_ID)]
    // spk0 と 500ms、spk1 と 1800ms 重なる → spk1
    expect(applyDiarization(segments, turns)[0]?.speakerId).toBe('remote:spk1')
  })

  it('自分トラックのセグメントは書き換えない', () => {
    const segments = [seg(100, 1800, '自分の発言', SELF_SPEAKER_ID)]
    expect(applyDiarization(segments, turns)[0]?.speakerId).toBe(SELF_SPEAKER_ID)
  })

  it('重なるターンが無い場合は元の話者 ID のままにする', () => {
    const segments = [seg(9000, 9500, '孤立した発言', REMOTE_SPEAKER_ID)]
    expect(applyDiarization(segments, turns)[0]?.speakerId).toBe(REMOTE_SPEAKER_ID)
  })

  it('ターンが空なら何も変更しない', () => {
    const segments = [seg(0, 1000, '発言', REMOTE_SPEAKER_ID)]
    expect(applyDiarization(segments, [])).toEqual(segments)
  })
})

describe('coalesceSegments', () => {
  it('同一話者の連続セグメントを結合する', () => {
    const segments = [
      seg(0, 1000, 'こんにちは', SELF_SPEAKER_ID),
      seg(1100, 2000, '今日はよろしくお願いします', SELF_SPEAKER_ID),
      seg(2200, 3000, 'よろしくお願いします', REMOTE_SPEAKER_ID)
    ]

    expect(coalesceSegments(segments)).toEqual([
      seg(0, 2000, 'こんにちは 今日はよろしくお願いします', SELF_SPEAKER_ID),
      seg(2200, 3000, 'よろしくお願いします', REMOTE_SPEAKER_ID)
    ])
  })

  it('間隔が閾値より開いていれば結合しない', () => {
    const segments = [seg(0, 1000, '前半', SELF_SPEAKER_ID), seg(20_000, 21_000, '後半', SELF_SPEAKER_ID)]
    expect(coalesceSegments(segments, { maxGapMs: 2000 })).toHaveLength(2)
  })
})

describe('formatTimestamp', () => {
  it('1 時間未満は mm:ss で表す', () => {
    expect(formatTimestamp(0)).toBe('00:00')
    expect(formatTimestamp(65_400)).toBe('01:05')
  })

  it('1 時間以上は h:mm:ss で表す', () => {
    expect(formatTimestamp(3_725_000)).toBe('1:02:05')
  })
})

describe('toMarkdown', () => {
  const speakers: Speaker[] = [
    { id: SELF_SPEAKER_ID, kind: 'self', label: '自分' },
    { id: 'remote:spk0', kind: 'remote', label: '田中さん' }
  ]

  it('話者ラベルとタイムスタンプ付きの Markdown を生成する', () => {
    const segments = [
      seg(0, 1000, 'おはようございます', SELF_SPEAKER_ID),
      seg(2000, 3000, 'よろしくお願いします', 'remote:spk0')
    ]

    expect(toMarkdown(segments, speakers)).toBe(
      ['**[00:00] 自分**', 'おはようございます', '', '**[00:02] 田中さん**', 'よろしくお願いします'].join('\n')
    )
  })

  it('未登録の話者 ID はそのまま表示する', () => {
    const segments = [seg(0, 1000, '発言', 'remote:spk9')]
    expect(toMarkdown(segments, speakers)).toContain('**[00:00] remote:spk9**')
  })
})
