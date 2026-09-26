import { describe, expect, it } from 'vitest'
import {
  parseVadSpans,
  parseWhisperJson,
  type DroppedSegment
} from '@infrastructure/transcription/WhisperCppTranscriber'

/**
 * VAD の発話区間をまたいだ発言を、区間ごとに切り直す（ADR-036）。
 *
 * whisper.cpp は VAD で無音を詰めた音声を文字起こしし、発言の開始・終了だけを元の
 * 時間軸へ戻す。飛び飛びの発話が 1 つの発言にまとまると、その発言は間の無音ごと
 * 何分にも伸びる。以下の値は、発話 → 60 秒の無音 → 発話 → 60 秒の無音 → 発話 の
 * 音声を同梱の whisper-cli（1.9.4）に通したときの実際の出力から取った。
 */
const STDERR = [
  'whisper_vad: detected 3 speech segments',
  'whisper_vad: vad_segment_info: orig_start: 0.00, orig_end: 1.98, vad_start: 0.00, vad_end: 1.98',
  'whisper_vad: vad_segment_info: orig_start: 62.50, orig_end: 63.33, vad_start: 2.18, vad_end: 3.01',
  'whisper_vad: vad_segment_info: orig_start: 123.39, orig_end: 125.09, vad_start: 3.21, vad_end: 4.90',
  'whisper_vad: Created time mapping table with 8 points'
].join('\n')

const SPANS = [
  { origStartMs: 0, origEndMs: 1_980, vadStartMs: 0, vadEndMs: 1_980 },
  { origStartMs: 62_500, origEndMs: 63_330, vadStartMs: 2_180, vadEndMs: 3_010 },
  { origStartMs: 123_390, origEndMs: 125_090, vadStartMs: 3_210, vadEndMs: 4_900 }
]

/** トークンの時刻は、無音を詰めたあとの時間軸のまま出てくる。 */
const token = (text: string, from: number, to: number, p = 0.9) => ({
  text,
  offsets: { from, to },
  p
})

const mergedJson = JSON.stringify({
  transcription: [
    {
      offsets: { from: 0, to: 124_980 },
      text: 'では今日の議題を始めます。了解です。それでは終わりにしましょう。',
      tokens: [
        token('[_BEG_]', 0, 0),
        token('では', 20, 260),
        token('今日の議題を始めます', 260, 1_560),
        token('。', 1_560, 1_850),
        token('了', 2_120, 2_120),
        token('解です', 2_210, 2_540),
        token('。', 2_540, 2_850),
        token('それでは', 3_240, 3_420),
        token('終わりにしましょう', 3_420, 4_430),
        token('。', 4_430, 4_800),
        token('[_TT_245]', 4_900, 4_900)
      ]
    }
  ]
})

describe('parseVadSpans', () => {
  it('whisper-cli のログから、元の時刻と詰めたあとの時刻の対応を読む', () => {
    expect(parseVadSpans(STDERR)).toEqual(SPANS)
  })

  it('対応が 1 行も無ければ空を返す（VAD 無し・ログの形式が変わった）', () => {
    expect(parseVadSpans('whisper_print_progress_callback: progress =  50%\n')).toEqual([])
  })
})

describe('parseWhisperJson（VAD の発話区間での切り直し）', () => {
  it('発話区間をまたいだ発言を、区間ごとの発言に切り分けて元の時刻を付ける', () => {
    expect(parseWhisperJson(mergedJson, 'self', undefined, SPANS)).toEqual([
      { startMs: 0, endMs: 1_980, speakerId: 'self', text: 'では今日の議題を始めます。' },
      { startMs: 62_500, endMs: 63_330, speakerId: 'self', text: '了解です。' },
      {
        startMs: 123_390,
        endMs: 124_980,
        speakerId: 'self',
        text: 'それでは終わりにしましょう。'
      }
    ])
  })

  it('1 つの区間に収まる発言は whisper の時刻のまま残す', () => {
    const raw = JSON.stringify({
      transcription: [
        {
          offsets: { from: 62_600, to: 63_300 },
          text: '了解です。',
          tokens: [token('了解です', 2_300, 2_800), token('。', 2_800, 2_900)]
        }
      ]
    })

    expect(parseWhisperJson(raw, 'self', undefined, SPANS)).toEqual([
      { startMs: 62_600, endMs: 63_300, speakerId: 'self', text: '了解です。' }
    ])
  })

  it('トークンを繋いでも本文と一致しないときは切らない（文字の欠けた本文を作らない）', () => {
    const raw = JSON.stringify({
      transcription: [
        {
          offsets: { from: 0, to: 124_980 },
          text: 'では。了解です。',
          tokens: [token('では。', 20, 260), token('了解', 2_300, 2_500)]
        }
      ]
    })

    expect(parseWhisperJson(raw, 'self', undefined, SPANS)).toEqual([
      { startMs: 0, endMs: 124_980, speakerId: 'self', text: 'では。了解です。' }
    ])
  })

  it('対応が無ければ今までどおり（VAD 無し・ログを読めなかった）', () => {
    expect(parseWhisperJson(mergedJson, 'self', undefined, [])).toHaveLength(1)
  })

  it('切り分けた発言ごとに確信度で落とす（無音側の空耳だけを落とせる）', () => {
    const raw = JSON.stringify({
      transcription: [
        {
          offsets: { from: 0, to: 63_330 },
          text: 'では。うん',
          tokens: [token('では', 20, 260), token('。', 260, 400), token('うん', 2_300, 2_500, 0.1)]
        }
      ]
    })
    const dropped: DroppedSegment[] = []

    expect(parseWhisperJson(raw, 'self', (d) => dropped.push(d), SPANS)).toEqual([
      { startMs: 0, endMs: 1_980, speakerId: 'self', text: 'では。' }
    ])
    expect(dropped).toMatchObject([
      { startMs: 62_500, endMs: 63_330, text: 'うん', reason: 'low-confidence' }
    ])
  })
})
