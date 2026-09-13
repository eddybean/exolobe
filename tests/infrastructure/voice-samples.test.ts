import { describe, expect, it } from 'vitest'
import {
  MAX_VOICE_MS,
  MIN_TURN_MS,
  MIN_VOICE_MS,
  selectVoiceRanges
} from '@infrastructure/diarization/voiceSamples'
import type { SpeakerTurn } from '@domain/TranscriptSegment'

const turn = (startMs: number, endMs: number, speaker: string): SpeakerTurn => ({
  startMs,
  endMs,
  speaker
})

describe('selectVoiceRanges', () => {
  it('話者ごとに発話区間をまとめる', () => {
    const ranges = selectVoiceRanges([
      turn(0, 3000, 'spk0'),
      turn(3000, 6000, 'spk1'),
      turn(6000, 9000, 'spk0')
    ])

    expect(ranges.get('spk0')).toEqual([
      { startMs: 0, endMs: 3000 },
      { startMs: 6000, endMs: 9000 }
    ])
    expect(ranges.get('spk1')).toEqual([{ startMs: 3000, endMs: 6000 }])
  })

  it('短すぎるターンは使わない（相槌で声紋が濁る）', () => {
    const ranges = selectVoiceRanges([
      turn(0, MIN_TURN_MS - 1, 'spk0'),
      turn(1000, 4000, 'spk0')
    ])

    expect(ranges.get('spk0')).toEqual([{ startMs: 1000, endMs: 4000 }])
  })

  it('合計が短すぎる話者は声紋を作らない', () => {
    const ranges = selectVoiceRanges([turn(0, MIN_VOICE_MS - 1, 'spk0')])

    expect(ranges.has('spk0')).toBe(false)
  })

  it('長い話者は上限までで打ち切る', () => {
    const turns = Array.from({ length: 20 }, (_, index) =>
      turn(index * 5000, index * 5000 + 4000, 'spk0')
    )

    const ranges = selectVoiceRanges(turns) ?? new Map()
    const total = (ranges.get('spk0') ?? []).reduce(
      (sum, range) => sum + (range.endMs - range.startMs),
      0
    )

    expect(total).toBe(MAX_VOICE_MS)
  })

  it('上限の打ち切りは長いターンから選ぶ（安定した声が残る）', () => {
    const ranges = selectVoiceRanges(
      [turn(0, 1000, 'spk0'), turn(2000, 12_000, 'spk0'), turn(20_000, 21_000, 'spk0')],
      { maxVoiceMs: 10_000 }
    )

    expect(ranges.get('spk0')).toEqual([{ startMs: 2000, endMs: 12_000 }])
  })

  it('打ち切った後も時系列の順に並べ直す', () => {
    const ranges = selectVoiceRanges(
      [turn(0, 5000, 'spk0'), turn(10_000, 20_000, 'spk0')],
      { maxVoiceMs: 15_000 }
    )

    expect(ranges.get('spk0')).toEqual([
      { startMs: 0, endMs: 5000 },
      { startMs: 10_000, endMs: 20_000 }
    ])
  })

  it('ターンが無ければ空を返す', () => {
    expect(selectVoiceRanges([])).toEqual(new Map())
  })
})
