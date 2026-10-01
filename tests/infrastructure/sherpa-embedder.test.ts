import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WavFileWriter, int16Buffer } from '@infrastructure/audio/wav'
import {
  NullSpeakerEmbedder,
  SherpaOnnxSpeakerEmbedder,
  type SpeakerEmbeddingSession,
  type SpeakerEmbeddingSessionFactory
} from '@infrastructure/diarization/SherpaOnnxSpeakerEmbedder'
import type { SpeakerTurn } from '@domain/TranscriptSegment'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omr-embed-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** 秒数ぶんの 16kHz 無音 WAV を作る。中身は範囲の切り出しだけを確かめるので値は使わない。 */
const writeWav = async (seconds: number, sampleRate = 16_000): Promise<string> => {
  const path = join(dir, 'system.wav')
  const writer = await WavFileWriter.create(path, { sampleRate })
  await writer.write(int16Buffer(Array.from({ length: sampleRate * seconds }, (_, i) => i % 100)))
  await writer.close()
  return path
}

class FakeSession implements SpeakerEmbeddingSession {
  received: Float32Array[] = []
  disposed = 0
  error?: Error

  constructor(private readonly result?: Float32Array) {}

  compute(samples: Float32Array): Float32Array {
    this.received.push(samples)
    if (this.error) throw this.error
    return this.result ?? Float32Array.from([samples.length, 0, 0, 0])
  }

  dispose(): void {
    this.disposed += 1
  }
}

class FakeFactory implements SpeakerEmbeddingSessionFactory {
  calls: { embeddingModelPath: string }[] = []

  constructor(readonly session = new FakeSession()) {}

  async create(config: { embeddingModelPath: string }): Promise<SpeakerEmbeddingSession> {
    this.calls.push(config)
    return this.session
  }
}

const turn = (startMs: number, endMs: number, speaker: string): SpeakerTurn => ({
  startMs,
  endMs,
  speaker
})

const config = { embeddingModelPath: '/models/campplus.onnx' }

describe('SherpaOnnxSpeakerEmbedder', () => {
  it('モデルのファイル名を modelKey にする（差し替えを検出できる）', () => {
    const embedder = new SherpaOnnxSpeakerEmbedder(config, new FakeFactory())

    expect(embedder.modelKey).toBe('campplus.onnx')
  })

  it('長さ 1 に正規化して返す（類似度を内積だけで求められるようにする）', async () => {
    // sherpa の compute() はノルム 10 前後の生のベクトルを返す。正規化を忘れると
    // 内積が「ノルム × コサイン」になり、閾値も 2 位との差も効かなくなる。
    const factory = new FakeFactory(new FakeSession(Float32Array.from([30, 40, 0, 0])))
    const embedder = new SherpaOnnxSpeakerEmbedder(config, factory)
    const wavPath = await writeWav(20)

    const [entry] = await embedder.embedSpeakers({
      wavPath,
      turns: [turn(0, 5000, 'spk0')]
    })

    expect(Array.from(entry?.vector ?? [])).toEqual([expect.closeTo(0.6), expect.closeTo(0.8), 0, 0])
  })

  it('話者ごとに 1 本の声紋を返す', async () => {
    const factory = new FakeFactory()
    const embedder = new SherpaOnnxSpeakerEmbedder(config, factory)
    const wavPath = await writeWav(20)

    const result = await embedder.embedSpeakers({
      wavPath,
      turns: [turn(0, 5000, 'spk0'), turn(5000, 10_000, 'spk1'), turn(10_000, 15_000, 'spk0')]
    })

    expect(result.map((entry) => entry.speaker).sort()).toEqual(['spk0', 'spk1'])
    expect(result[0]?.vector).toBeInstanceOf(Float32Array)
  })

  it('発話の合計が短い話者は声紋を作らない', async () => {
    const factory = new FakeFactory()
    const embedder = new SherpaOnnxSpeakerEmbedder(config, factory)
    const wavPath = await writeWav(20)

    const result = await embedder.embedSpeakers({
      wavPath,
      turns: [turn(0, 5000, 'spk0'), turn(6000, 7200, 'spk1')]
    })

    expect(result.map((entry) => entry.speaker)).toEqual(['spk0'])
  })

  it('その話者の発話だけを繋いで渡す', async () => {
    const factory = new FakeFactory()
    const embedder = new SherpaOnnxSpeakerEmbedder(config, factory)
    const wavPath = await writeWav(20)

    await embedder.embedSpeakers({
      wavPath,
      turns: [turn(0, 4000, 'spk0'), turn(10_000, 13_000, 'spk0')]
    })

    // 4 秒 + 3 秒 = 7 秒ぶんのサンプル。
    expect(factory.session.received[0]?.length).toBe(16_000 * 7)
  })

  it('録音の終端を越える範囲は切り詰める', async () => {
    const factory = new FakeFactory()
    const embedder = new SherpaOnnxSpeakerEmbedder(config, factory)
    const wavPath = await writeWav(5)

    await embedder.embedSpeakers({ wavPath, turns: [turn(0, 60_000, 'spk0')] })

    expect(factory.session.received[0]?.length).toBe(16_000 * 5)
  })

  it('ターンが無ければセッションを作らない', async () => {
    const factory = new FakeFactory()
    const embedder = new SherpaOnnxSpeakerEmbedder(config, factory)
    const wavPath = await writeWav(5)

    expect(await embedder.embedSpeakers({ wavPath, turns: [] })).toEqual([])
    expect(factory.calls).toHaveLength(0)
  })

  it('失敗してもセッションを必ず閉じる', async () => {
    const factory = new FakeFactory()
    factory.session.error = new Error('推論に失敗')
    const embedder = new SherpaOnnxSpeakerEmbedder(config, factory)
    const wavPath = await writeWav(20)

    await expect(embedder.embedSpeakers({ wavPath, turns: [turn(0, 5000, 'spk0')] })).rejects.toThrow()
    expect(factory.session.disposed).toBe(1)
  })

  it('成功したときもセッションを閉じる', async () => {
    const factory = new FakeFactory()
    const embedder = new SherpaOnnxSpeakerEmbedder(config, factory)
    const wavPath = await writeWav(20)

    await embedder.embedSpeakers({ wavPath, turns: [turn(0, 5000, 'spk0')] })

    expect(factory.session.disposed).toBe(1)
  })
})

describe('NullSpeakerEmbedder', () => {
  it('声紋を返さない（話者識別だけが動く）', async () => {
    const embedder = new NullSpeakerEmbedder()

    expect(embedder.modelKey).toBe('')
    expect(await embedder.embedSpeakers()).toEqual([])
  })
})
