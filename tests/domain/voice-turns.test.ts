import { describe, expect, it } from 'vitest'
import type { TranscriptSegment } from '@domain/TranscriptSegment'
import { SELF_SPEAKER_ID } from '@domain/Speaker'
import { VOICE_TURN_GUARD_MS, voiceTurnsFromTranscript } from '@domain/VoiceTurns'

const segment = (speakerId: string, startMs: number, endMs: number): TranscriptSegment => ({
  speakerId,
  startMs,
  endMs,
  text: 'あ'
})

describe('voiceTurnsFromTranscript', () => {
  it('相手のクラスタからターンを作り、クラスタ名を speaker に入れる', () => {
    const turns = voiceTurnsFromTranscript([segment('remote:spk0', 0, 5_000), segment('remote:spk1', 6_000, 9_000)])

    expect(turns).toEqual([
      { speaker: 'spk0', startMs: 0, endMs: 5_000 },
      { speaker: 'spk1', startMs: 6_000, endMs: 9_000 }
    ])
  })

  it('自分の発話は声紋の対象にしない', () => {
    expect(voiceTurnsFromTranscript([segment(SELF_SPEAKER_ID, 0, 5_000)])).toEqual([])
  })

  it('クラスタの付いていない裸の remote は対象にしない', () => {
    expect(voiceTurnsFromTranscript([segment('remote', 0, 5_000)])).toEqual([])
  })

  it('自分の発話と完全に重なるターンは消える', () => {
    const turns = voiceTurnsFromTranscript([segment('remote:spk0', 1_000, 3_000), segment(SELF_SPEAKER_ID, 0, 4_000)])

    expect(turns).toEqual([])
  })

  it('部分的に重なるターンは、重なりを除いた断片に分かれる', () => {
    const turns = voiceTurnsFromTranscript([segment('remote:spk0', 0, 10_000), segment(SELF_SPEAKER_ID, 4_000, 6_000)])

    expect(turns).toEqual([
      { speaker: 'spk0', startMs: 0, endMs: 4_000 - VOICE_TURN_GUARD_MS },
      { speaker: 'spk0', startMs: 6_000 + VOICE_TURN_GUARD_MS, endMs: 10_000 }
    ])
  })

  it('連続する自分の発話はまとめて 1 つの区間として引く', () => {
    const turns = voiceTurnsFromTranscript([
      segment('remote:spk0', 0, 20_000),
      segment(SELF_SPEAKER_ID, 5_000, 8_000),
      segment(SELF_SPEAKER_ID, 8_100, 12_000)
    ])

    expect(turns).toEqual([
      { speaker: 'spk0', startMs: 0, endMs: 5_000 - VOICE_TURN_GUARD_MS },
      { speaker: 'spk0', startMs: 12_000 + VOICE_TURN_GUARD_MS, endMs: 20_000 }
    ])
  })

  it('長さが無くなった断片は返さない', () => {
    const turns = voiceTurnsFromTranscript([segment('remote:spk0', 0, 5_000), segment(SELF_SPEAKER_ID, 0, 4_999)])

    expect(turns).toEqual([])
  })
})
