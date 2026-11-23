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

  it('発話区間ごとに認識し、区間の開始をトークンの時刻に足して録音の時刻にする', async () => {
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
      { startMs: 2000, endMs: 5000, speakerId: 'remote', text: '本日は' },
      { startMs: 10100, endMs: 12000, speakerId: 'remote', text: '以上です' }
    ])
    expect(session.recognized).toEqual([48_000, 32_000])
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
      { startMs: 1100, endMs: 3400, speakerId: 'remote', text: '確認します。' },
      { startMs: 3400, endMs: 7000, speakerId: 'remote', text: 'まず報告です。' }
    ])
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

  it('確信度の閾値は指定したときだけ使う', async () => {
    const low = (): FakeSession => new FakeSession([span(0, 2)], [recognition([['ええと', 0.1]], -2)])
    const dropped: DroppedSegment[] = []

    expect(await transcribe(low(), await wav(2))).toHaveLength(1)
    expect(await transcribe(low(), await wav(2), { minAvgLogprob: -1, onDropped: (d) => dropped.push(d) })).toEqual([])
    expect(dropped).toEqual([expect.objectContaining({ reason: 'low-confidence', avgLogprob: -2 })])
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

  it('英単語どうしの間の空白は残す', () => {
    expect(joinTokens(['次は', ' Google', ' Meet', ' で'])).toBe('次はGoogle Meetで')
  })
})
