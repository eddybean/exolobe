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

describe('parseWhisperJson（トークンの時刻のずれ）', () => {
  /**
   * macOS の `say`（Kyoko）で作った 11 の発話を、弱い雑音の無音（1〜20 秒）を挟んで並べ、
   * 同梱の whisper-cli（1.9.4、large-v3-turbo q5_0、`--vad --output-json-full`）に通した実際の出力。
   * 全体が 1 つの発言にまとまり、トークンの時刻は区間の境目から最大 0.5 秒ほど後ろへずれる。
   * 6 つ目と 7 つ目の区間は 1 つの文の途中（「インデ」「ックス」の間）を VAD が割ったもの。
   */
  const DRIFT_STDERR = [
    'whisper_vad: vad_segment_info: orig_start: 0.96, orig_end: 2.24, vad_start: 0.00, vad_end: 1.28',
    'whisper_vad: vad_segment_info: orig_start: 2.53, orig_end: 4.22, vad_start: 1.48, vad_end: 3.17',
    'whisper_vad: vad_segment_info: orig_start: 7.75, orig_end: 9.47, vad_start: 3.37, vad_end: 5.09',
    'whisper_vad: vad_segment_info: orig_start: 17.35, orig_end: 20.77, vad_start: 5.29, vad_end: 8.71',
    'whisper_vad: vad_segment_info: orig_start: 40.74, orig_end: 41.50, vad_start: 8.91, vad_end: 9.67',
    'whisper_vad: vad_segment_info: orig_start: 48.45, orig_end: 49.76, vad_start: 9.87, vad_end: 11.18',
    'whisper_vad: vad_segment_info: orig_start: 49.99, orig_end: 52.99, vad_start: 11.38, vad_end: 14.38',
    'whisper_vad: vad_segment_info: orig_start: 65.03, orig_end: 67.13, vad_start: 14.58, vad_end: 16.68',
    'whisper_vad: vad_segment_info: orig_start: 69.25, orig_end: 70.11, vad_start: 16.88, vad_end: 17.74',
    'whisper_vad: vad_segment_info: orig_start: 76.13, orig_end: 77.82, vad_start: 17.94, vad_end: 19.63',
    'whisper_vad: vad_segment_info: orig_start: 78.85, orig_end: 80.00, vad_start: 19.83, vad_end: 20.98',
    'whisper_vad: vad_segment_info: orig_start: 83.94, orig_end: 87.07, vad_start: 21.18, vad_end: 24.31'
  ].join('\n')

  const DRIFT_TOKENS: [string, number, number][] = [
    ['[_BEG_]', 0, 0], ['お', 50, 140], ['は', 180, 320], ['よう', 320, 640], ['ございます', 640, 1070],
    ['。', 1530, 1870],
    ['今日', 1870, 2150], ['の', 2160, 2290], ['定', 2290, 2430], ['例', 2430, 2570], ['を', 2570, 2710],
    ['始', 2710, 2850], ['め', 2850, 2990], ['ます', 2990, 3060], ['。', 3400, 3560],
    ['はい', 3830, 3870], ['、', 3870, 4070], ['そうですね', 4100, 4500], ['、', 4770, 4930],
    ['はい', 5240, 5240], ['。', 5310, 5570],
    ['ロ', 5570, 5680], ['グ', 5680, 5780], ['イ', 5810, 5900], ['ン', 5900, 6010], ['画', 6010, 6120],
    ['面', 6120, 6230], ['の', 6230, 6300], ['回', 6390, 6450], ['収', 6450, 6780], ['は', 6780, 6880],
    ['予', 6880, 7220], ['定', 7220, 7260], ['通', 7350, 7440], ['り', 7440, 7530], ['終', 7570, 7660],
    ['わ', 7660, 7770], ['りました', 7770, 8210], ['。', 8210, 8460],
    ['了', 8530, 8630], ['解', 8860, 8860], ['です', 8920, 9130], ['。', 9220, 9550],
    ['検', 9900, 10080], ['索', 10080, 10480], ['は', 10480, 10580], ['イ', 10700, 10740],
    ['ンデ', 10740, 11100], ['ック', 11370, 11370], ['ス', 11380, 11470], ['の', 11470, 11600],
    ['作', 11600, 11750], ['り', 11860, 12040], ['直', 12040, 12260], ['し', 12260, 12480],
    ['に', 12480, 12650], ['時間', 12800, 12910], ['が', 13010, 13100], ['か', 13100, 13220],
    ['か', 13220, 13340], ['って', 13340, 13510], ['います', 13590, 13940], ['。', 13940, 14220],
    ['来', 14600, 14670], ['週', 14670, 15040], ['まで', 15040, 15230], ['には', 15230, 15420],
    ['終', 15420, 15510], ['わ', 15510, 15600], ['る', 15600, 15690], ['見', 15690, 15780],
    ['込', 15780, 16060], ['み', 16060, 16130], ['です', 16230, 16340], ['。', 16340, 16590],
    ['わか', 16880, 16910], ['りました', 16910, 17290], ['。', 17290, 17490],
    ['他', 17570, 17670], ['に', 17900, 17900], ['何', 17950, 18010], ['か', 18090, 18220],
    ['あります', 18220, 18880], ['か', 18880, 19040], ['?', 19040, 19540],
    ['特', 19680, 19680], ['に', 19800, 19800], ['あり', 19840, 20050], ['ません', 20050, 20430],
    ['。', 20430, 20840],
    ['では', 20840, 20890], ['、', 21200, 21300], ['終', 21300, 21410], ['わ', 21410, 21480],
    ['り', 21630, 21630], ['に', 21690, 21740], ['し', 21740, 21850], ['ましょう', 21850, 22320],
    ['。', 22320, 22670],
    ['お', 22670, 22770], ['疲', 23000, 23090], ['れ', 23160, 23200], ['様', 23290, 23340],
    ['でした', 23340, 23690], ['。', 23690, 24080],
    ['[_TT_1207]', 24140, 24140]
  ]

  const driftJson = JSON.stringify({
    transcription: [
      {
        offsets: { from: 960, to: 86900 },
        text: 'おはようございます。今日の定例を始めます。はい、そうですね、はい。ログイン画面の回収は予定通り終わりました。了解です。検索はインデックスの作り直しに時間がかかっています。来週までには終わる見込みです。わかりました。他に何かありますか?特にありません。では、終わりにしましょう。お疲れ様でした。',
        tokens: DRIFT_TOKENS.map(([text, from, to]) => token(text, from, to))
      }
    ]
  })

  it('区間の頭のトークンが前の区間の時刻に載っても、語の途中や句読点の前では切らない', () => {
    const segments = parseWhisperJson(driftJson, 'self', undefined, parseVadSpans(DRIFT_STDERR))

    expect(segments.map(({ startMs, endMs, text }) => [startMs, endMs, text])).toEqual([
      [960, 2_240, 'おはようございます。'],
      [2_530, 4_220, '今日の定例を始めます。'],
      [7_750, 9_470, 'はい、そうですね、はい。'],
      [17_350, 20_770, 'ログイン画面の回収は予定通り終わりました。'],
      [40_740, 41_500, '了解です。'],
      // 0.23 秒しか空いていない区間の境目で、句読点も近くに無い。語の途中で割らずに 1 つに残す
      [48_450, 52_990, '検索はインデックスの作り直しに時間がかかっています。'],
      [65_030, 67_130, '来週までには終わる見込みです。'],
      [69_250, 70_110, 'わかりました。'],
      [76_130, 77_820, '他に何かありますか?'],
      [78_850, 80_000, '特にありません。'],
      [83_940, 86_900, 'では、終わりにしましょう。お疲れ様でした。']
    ])
  })

  it('句読点のトークンが次の区間の時刻に載っても、次の発言の頭に回さない（句読点だけの発言も作らない）', () => {
    const raw = JSON.stringify({
      transcription: [
        {
          offsets: { from: 0, to: 63_330 },
          text: 'はい。了解',
          tokens: [token('はい', 20, 260), token('。', 2_300, 2_400), token('了解', 2_500, 2_800)]
        }
      ]
    })

    expect(parseWhisperJson(raw, 'self', undefined, SPANS)).toEqual([
      { startMs: 0, endMs: 1_980, speakerId: 'self', text: 'はい。' },
      { startMs: 62_500, endMs: 63_330, speakerId: 'self', text: '了解' }
    ])
  })

  it('長い無音を挟んだ区間の境目は、句読点が無くても切る（無音ごと伸ばさない）', () => {
    const raw = JSON.stringify({
      transcription: [
        {
          offsets: { from: 0, to: 63_330 },
          text: 'うんはい',
          tokens: [token('うん', 20, 260), token('はい', 2_300, 2_500)]
        }
      ]
    })

    expect(parseWhisperJson(raw, 'self', undefined, SPANS)).toEqual([
      { startMs: 0, endMs: 1_980, speakerId: 'self', text: 'うん' },
      { startMs: 62_500, endMs: 63_330, speakerId: 'self', text: 'はい' }
    ])
  })

  /**
   * ReazonSpeech / FLEURS のクリップを 4〜40 秒の雑音の間で並べた長尺音声の実測。whisper の発言の頭が、
   * 12 秒前に終わった区間のお尻に数十 ms だけ掛かっていた。区間の境目 51900 に最も近いトークンの
   * 切れ目は「ジャ|ン」で、「ジャ」だけが 206070-206110 の発言になっていた。
   */
  it('発言の頭が前の区間に数十 ms だけ掛かっても、語の途中で切って頭を前の区間に残さない', () => {
    const spans = [
      { origStartMs: 198_630, origEndMs: 206_110, vadStartMs: 44_320, vadEndMs: 51_800 },
      { origStartMs: 218_820, origEndMs: 225_050, vadStartMs: 52_000, vadEndMs: 58_230 }
    ]
    const raw = JSON.stringify({
      transcription: [
        {
          offsets: { from: 206_070, to: 224_900 },
          text: 'ジャンカルド・フィジケラが優勝した。',
          tokens: [
            token('[_BEG_]', 51_760, 51_760),
            token('ジャ', 51_790, 51_850),
            token('ン', 51_890, 52_000),
            token('カルド', 52_000, 52_400),
            token('・', 52_400, 52_500),
            token('フィジケラ', 52_500, 53_600),
            token('が', 53_600, 53_800),
            token('優勝した', 53_800, 57_600),
            token('。', 57_600, 58_100)
          ]
        }
      ]
    })

    expect(parseWhisperJson(raw, 'r', undefined, spans)).toEqual([
      {
        startMs: 218_820,
        endMs: 224_900,
        speakerId: 'r',
        text: 'ジャンカルド・フィジケラが優勝した。'
      }
    ])
  })

  it('発言のお尻が次の区間に数十 ms だけ掛かっても、文末を次の区間へ送らない', () => {
    // 実測では「…無罪を主張」が 206880-215840、「しました。」が 36 秒後ろの 252350-252360 になった
    const spans = [
      { origStartMs: 205_700, origEndMs: 215_840, vadStartMs: 80_000, vadEndMs: 90_140 },
      { origStartMs: 252_350, origEndMs: 258_000, vadStartMs: 90_340, vadEndMs: 95_990 }
    ]
    const raw = JSON.stringify({
      transcription: [
        {
          offsets: { from: 206_880, to: 252_360 },
          text: '被告は無罪を主張しました。',
          tokens: [
            token('被告', 81_180, 81_900),
            token('は', 81_900, 82_100),
            token('無罪', 82_100, 84_000),
            token('を', 84_000, 84_300),
            token('主張', 84_300, 90_150),
            token('しました', 90_190, 90_330),
            token('。', 90_330, 90_350)
          ]
        }
      ]
    })

    expect(parseWhisperJson(raw, 'r', undefined, spans)).toEqual([
      { startMs: 206_880, endMs: 215_840, speakerId: 'r', text: '被告は無罪を主張しました。' }
    ])
  })

  it('発言の頭とお尻が前後の区間に掛かっても、1 つの区間の発言に収める', () => {
    // 実測では「これ」「でいき」「ましょう。」の 3 つに割れ、「ましょう。」は 12 秒後ろへ送られた
    const spans = [
      { origStartMs: 370_000, origEndMs: 376_160, vadStartMs: 10_000, vadEndMs: 16_160 },
      { origStartMs: 406_590, origEndMs: 413_340, vadStartMs: 16_360, vadEndMs: 23_110 },
      { origStartMs: 418_590, origEndMs: 425_000, vadStartMs: 23_310, vadEndMs: 29_720 }
    ]
    const raw = JSON.stringify({
      transcription: [
        {
          offsets: { from: 376_020, to: 418_600 },
          text: 'これでいきましょう。',
          tokens: [
            token('これ', 16_020, 16_300),
            token('でいき', 16_300, 21_000),
            token('ましょう', 21_000, 23_300),
            token('。', 23_300, 23_320)
          ]
        }
      ]
    })

    expect(parseWhisperJson(raw, 'r', undefined, spans)).toEqual([
      { startMs: 406_590, endMs: 413_340, speakerId: 'r', text: 'これでいきましょう。' }
    ])
  })

  it('短い間で割れた区間の境目は、読点では切らない（文の途中の息継ぎ）', () => {
    // 同じ音声の並びを変えた実測で、0.22 秒の間が「検索は、」と「インデックスの…」を割った
    const spans = [
      { origStartMs: 21_350, origEndMs: 22_690, vadStartMs: 510, vadEndMs: 1_850 },
      { origStartMs: 22_910, origEndMs: 25_920, vadStartMs: 2_050, vadEndMs: 5_060 }
    ]
    const raw = JSON.stringify({
      transcription: [
        {
          offsets: { from: 21_350, to: 25_820 },
          text: '検索は、インデックスの作り直しです。',
          tokens: [
            token('検索は', 520, 1_400),
            token('、', 1_400, 1_700),
            token('インデックスの作り直しです', 2_200, 4_600),
            token('。', 4_600, 4_900)
          ]
        }
      ]
    })

    expect(parseWhisperJson(raw, 'self', undefined, spans)).toEqual([
      {
        startMs: 21_350,
        endMs: 25_820,
        speakerId: 'self',
        text: '検索は、インデックスの作り直しです。'
      }
    ])
  })
})
