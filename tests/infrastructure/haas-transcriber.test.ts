import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WavFileWriter, int16Buffer } from '@infrastructure/audio/wav'
import {
  SherpaHaasTranscriber,
  joinTokens,
  type HaasModelPaths,
  type HaasRecognition,
  type HaasSession,
  type HaasSessionFactory,
  type HaasSpeechSpan
} from '@infrastructure/transcription/SherpaHaasTranscriber'
import type { DroppedSegment } from '@infrastructure/transcription/segmentFilters'

const MODEL: HaasModelPaths = {
  encoderPath: '/m/encoder.onnx',
  decoderPath: '/m/decoder.onnx',
  joinerPath: '/m/joiner.onnx',
  tokensPath: '/m/tokens.txt',
  vadModelPath: '/m/silero_vad.onnx'
}

/** 認識結果を「トークン@秒」の並びで書く。確率は省けば確信度が高いものとして扱う。 */
const recognition = (spec: readonly (readonly [string, number])[], logProb = -0.01): HaasRecognition => ({
  tokens: spec.map(([token]) => token),
  timestamps: spec.map(([, at]) => at),
  logProbs: spec.map(() => logProb)
})

class FakeSession implements HaasSession {
  readonly sampleRate = 16_000
  disposed = false
  resampledFrom: number | undefined
  recognized: number[] = []

  constructor(
    private readonly spans: readonly HaasSpeechSpan[],
    private readonly results: readonly HaasRecognition[]
  ) {}

  resample(samples: Float32Array, fromRate: number): Float32Array {
    this.resampledFrom = fromRate
    return new Float32Array(Math.round((samples.length * this.sampleRate) / fromRate))
  }

  detectSpeech(): HaasSpeechSpan[] {
    return [...this.spans]
  }

  recognize(samples: Float32Array): HaasRecognition {
    this.recognized.push(samples.length)
    const result = this.results[this.recognized.length - 1]
    if (!result) throw new Error('decode failed')
    return result
  }

  dispose(): void {
    this.disposed = true
  }
}

class FakeFactory implements HaasSessionFactory {
  created = 0
  constructor(readonly session: FakeSession) {}
  async create(): Promise<HaasSession> {
    this.created += 1
    return this.session
  }
}

const span = (startSec: number, lengthSec: number): HaasSpeechSpan => ({
  startSample: Math.round(startSec * 16_000),
  samples: new Float32Array(Math.round(lengthSec * 16_000))
})

describe('SherpaHaasTranscriber', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'haas-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const wav = async (seconds: number, sampleRate = 16_000): Promise<string> => {
    const path = join(dir, `${seconds}-${sampleRate}.wav`)
    const writer = await WavFileWriter.create(path, { sampleRate, channels: 1 })
    await writer.write(int16Buffer(new Array<number>(Math.round(seconds * sampleRate)).fill(100)))
    await writer.close()
    return path
  }

  const transcribe = async (
    session: FakeSession,
    wavPath: string,
    options: { minAvgLogprob?: number; onDropped?: (dropped: DroppedSegment) => void } = {}
  ) => {
    const transcriber = new SherpaHaasTranscriber({ ...MODEL, ...options }, new FakeFactory(session))
    return transcriber.transcribe({ wavPath, language: 'ja', speakerId: 'remote' })
  }

  it('モデルが揃っていなければ、推論せずに理由つきで失敗する', async () => {
    const transcriber = new SherpaHaasTranscriber(
      { ...MODEL, joinerPath: '' },
      new FakeFactory(new FakeSession([], []))
    )

    await expect(
      transcriber.transcribe({ wavPath: await wav(1), language: 'ja', speakerId: 'remote' })
    ).rejects.toMatchObject({ reason: { code: 'haasModelNotConfigured' } })
  })

  it('サンプルの無い WAV ではセッションを作らない', async () => {
    const factory = new FakeFactory(new FakeSession([], []))
    const transcriber = new SherpaHaasTranscriber(MODEL, factory)

    expect(await transcriber.transcribe({ wavPath: await wav(0), language: 'ja', speakerId: 'remote' })).toEqual([])
    expect(factory.created).toBe(0)
  })

  it('発話区間の前後を 0.25 秒広げて認識し、広げた先頭からのトークンの時刻を録音の時刻にする', async () => {
    const session = new FakeSession(
      [span(2, 3), span(10, 2)],
      [
        recognition([
          [' ', 0],
          ['本日', 0.2],
          ['は', 0.6]
        ]),
        recognition([
          ['以上', 0.1],
          ['です', 0.5]
        ])
      ]
    )

    const segments = await transcribe(session, await wav(15))

    expect(segments).toEqual([
      { startMs: 1750, endMs: 5000, speakerId: 'remote', text: '本日は' },
      { startMs: 9850, endMs: 12000, speakerId: 'remote', text: '以上です' }
    ])
    // Silero VAD は語頭を遅れて検出し、そのまま渡すと「ありがとう」が「視聴者」のように削れて聞き違える。
    expect(session.recognized).toEqual([56_000, 40_000])
    expect(session.disposed).toBe(true)
  })

  it('長い発話区間は文末で分け、次の文の最初のトークンの時刻で区切る', async () => {
    const session = new FakeSession(
      [span(1, 6)],
      [
        recognition([
          ['確認', 0.1],
          ['します', 0.5],
          ['。', 0.9],
          ['まず', 2.4],
          ['報告', 2.8],
          ['です', 3.2],
          ['。', 3.6]
        ])
      ]
    )

    const segments = await transcribe(session, await wav(8))

    expect(segments).toEqual([
      { startMs: 850, endMs: 3150, speakerId: 'remote', text: '確認します。' },
      { startMs: 3150, endMs: 7000, speakerId: 'remote', text: 'まず報告です。' }
    ])
  })

  it('録音の端を越えては広げない', async () => {
    const session = new FakeSession([span(0, 5)], [recognition([['はい', 0.1]])])

    const segments = await transcribe(session, await wav(5))

    expect(session.recognized).toEqual([80_000])
    expect(segments[0]?.startMs).toBe(100)
  })

  it('句点が無くても、0.6 秒以上の間があれば分ける', async () => {
    const session = new FakeSession(
      [span(0, 5)],
      [
        recognition([
          ['はい', 0.1],
          ['そう', 1.5],
          ['です', 1.8]
        ])
      ]
    )

    const segments = await transcribe(session, await wav(5))

    expect(segments.map((segment) => segment.text)).toEqual(['はい', 'そうです'])
    expect(segments[1]?.startMs).toBe(1500)
  })

  it('何も認識しなかった区間は捨てる', async () => {
    const session = new FakeSession([span(0, 2)], [recognition([[' ', 0]])])

    expect(await transcribe(session, await wav(2))).toEqual([])
  })

  it('定型句と非発話マーカーは落とし、理由を知らせる', async () => {
    const session = new FakeSession(
      [span(0, 2), span(3, 2)],
      [recognition([['ご視聴ありがとうございました', 0]]), recognition([['[音楽]', 0]])]
    )
    const dropped: DroppedSegment[] = []

    const segments = await transcribe(session, await wav(6), { onDropped: (d) => dropped.push(d) })

    expect(segments).toEqual([])
    expect(dropped.map((d) => d.reason)).toEqual(['boilerplate', 'non-speech'])
  })

  it('既定では平均対数確率が -1 を下回る文を落とす', async () => {
    // 無音のクリップで VAD をすり抜けた区間から「下がり、」(-1.41) が出た。本物の発話の文は -0.53 より上だった。
    const session = (logProb: number): FakeSession =>
      new FakeSession([span(0, 2)], [recognition([['下がり', 0.1]], logProb)])
    const dropped: DroppedSegment[] = []

    expect(await transcribe(session(-0.9), await wav(2))).toHaveLength(1)
    expect(await transcribe(session(-1.4), await wav(2), { onDropped: (d) => dropped.push(d) })).toEqual([])
    expect(dropped).toEqual([expect.objectContaining({ reason: 'low-confidence', avgLogprob: -1.4 })])
  })

  it('確信度の閾値は差し替えられる', async () => {
    const session = new FakeSession([span(0, 2)], [recognition([['ええと', 0.1]], -0.5)])

    expect(await transcribe(session, await wav(2), { minAvgLogprob: -0.3 })).toEqual([])
  })

  it('息や雑音から出る「む」「むぅ」は定型句として落とす', async () => {
    const session = new FakeSession(
      [span(0, 1), span(2, 1)],
      [recognition([['むぅ', 0.1]], -0.8), recognition([['む', 0.1]], -0.8)]
    )
    const dropped: DroppedSegment[] = []

    expect(await transcribe(session, await wav(4), { onDropped: (d) => dropped.push(d) })).toEqual([])
    expect(dropped.map((d) => d.reason)).toEqual(['boilerplate', 'boilerplate'])
  })

  it('同じ文が続くループは繰り返しとして落とす', async () => {
    const spans = [0, 1, 2, 3, 4].map((at) => span(at * 0.9, 0.5))
    const results = spans.map(() => recognition([['はい', 0]]))
    const dropped: DroppedSegment[] = []

    const segments = await transcribe(new FakeSession(spans, results), await wav(5), {
      onDropped: (d) => dropped.push(d)
    })

    expect(segments).toHaveLength(1)
    expect(dropped.every((d) => d.reason === 'repetition')).toBe(true)
  })

  it('16kHz 以外の録音はモデルのサンプルレートに直してから渡す', async () => {
    const session = new FakeSession([], [])

    await transcribe(session, await wav(1, 48_000))

    expect(session.resampledFrom).toBe(48_000)
  })

  it('進捗は発話区間を認識するたびに知らせ、最後は 1 になる', async () => {
    const session = new FakeSession([span(0, 1), span(5, 1)], [recognition([['あ', 0]]), recognition([['い', 0]])])
    const fractions: number[] = []
    const transcriber = new SherpaHaasTranscriber(MODEL, new FakeFactory(session))

    await transcriber.transcribe({
      wavPath: await wav(10),
      language: 'ja',
      speakerId: 'remote',
      onProgress: (fraction) => fractions.push(fraction)
    })

    expect(fractions).toEqual([0.1, 0.6, 1])
  })

  it('認識に失敗しても必ずセッションを閉じ、文字起こしの失敗として投げる', async () => {
    const session = new FakeSession([span(0, 1)], [])

    await expect(transcribe(session, await wav(1))).rejects.toMatchObject({
      reason: { code: 'transcriptionFailed', detail: 'decode failed' }
    })
    expect(session.disposed).toBe(true)
  })
})

describe('joinTokens', () => {
  it('語頭の印として届く空白は、日本語に接していれば落とす', () => {
    expect(joinTokens([' ', '本', '日の', ' 会議'])).toBe('本日の会議')
  })

  it('語彙に無い字はバイトのトークンで届くので、UTF-8 として戻す', () => {
    // 「捗」= E6 8D 97。実録音で「進<0xE6><0x8D><0x97>」のまま残っていた。
    expect(joinTokens(['進', '<0xE6>', '<0x8D>', '<0x97>', 'だと'])).toBe('進捗だと')
  })

  it('英単語どうしの間の空白は残す', () => {
    expect(joinTokens(['次は', ' Google', ' Meet', ' で'])).toBe('次はGoogle Meetで')
  })
})
