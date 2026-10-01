import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WavFileWriter, int16Buffer } from '@infrastructure/audio/wav'
import {
  DiarizationError,
  SherpaOnnxDiarizer,
  type DiarizationSession,
  type DiarizationSessionFactory,
  type DiarizationSegment
} from '@infrastructure/diarization/SherpaOnnxDiarizer'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omr-diarize-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const writeWav = async (name: string, samples: readonly number[], sampleRate = 16_000): Promise<string> => {
  const path = join(dir, name)
  const writer = await WavFileWriter.create(path, { sampleRate })
  await writer.write(int16Buffer(samples))
  await writer.close()
  return path
}

class FakeSession implements DiarizationSession {
  received?: Float32Array
  disposed = 0
  error?: Error

  constructor(
    readonly segments: DiarizationSegment[] = [],
    readonly sampleRate = 16_000
  ) {}

  process(samples: Float32Array): DiarizationSegment[] {
    this.received = samples
    if (this.error) throw this.error
    return this.segments
  }

  dispose(): void {
    this.disposed += 1
  }
}

class FakeFactory implements DiarizationSessionFactory {
  calls: {
    segmentationModelPath: string
    embeddingModelPath: string
    clusteringThreshold: number
  }[] = []
  error?: Error

  constructor(readonly session = new FakeSession()) {}

  async create(config: {
    segmentationModelPath: string
    embeddingModelPath: string
    clusteringThreshold: number
  }): Promise<DiarizationSession> {
    this.calls.push(config)
    if (this.error) throw this.error
    return this.session
  }
}

const config = {
  segmentationModelPath: '/models/seg.onnx',
  embeddingModelPath: '/models/emb.onnx',
  clusteringThreshold: 0.5
}

describe('SherpaOnnxDiarizer', () => {
  it('モデルが未設定なら推論を試みずに設定を促す', async () => {
    const factory = new FakeFactory()
    const diarizer = new SherpaOnnxDiarizer(
      { segmentationModelPath: '', embeddingModelPath: '', clusteringThreshold: 0.5 },
      factory
    )

    await expect(diarizer.diarize({ wavPath: 'x.wav', maxSpeakers: 6 })).rejects.toBeInstanceOf(DiarizationError)
    expect(factory.calls).toHaveLength(0)
  })

  it('空のトラックではセッションを作らずに空を返す', async () => {
    const factory = new FakeFactory()
    const wavPath = await writeWav('empty.wav', [])

    expect(await new SherpaOnnxDiarizer(config, factory).diarize({ wavPath, maxSpeakers: 6 })).toEqual([])
    expect(factory.calls).toHaveLength(0)
  })

  it('セグメントを話者ターンへ変換する', async () => {
    const session = new FakeSession([
      { start: 0, end: 1.5, speaker: 0 },
      { start: 1.5, end: 2.25, speaker: 1 }
    ])
    const factory = new FakeFactory(session)
    const wavPath = await writeWav('a.wav', [0, 1000, -1000])

    const turns = await new SherpaOnnxDiarizer(config, factory).diarize({ wavPath, maxSpeakers: 6 })

    expect(turns).toEqual([
      { startMs: 0, endMs: 1500, speaker: 'spk0' },
      { startMs: 1500, endMs: 2250, speaker: 'spk1' }
    ])
    expect(factory.calls).toEqual([config])
  })

  it('話者を分ける近さをそのままセッションへ渡す', async () => {
    // 同じ人が別人に割れるとき、利用者はここを上げて調整する。
    const factory = new FakeFactory()
    const wavPath = await writeWav('threshold.wav', [0, 1000])

    await new SherpaOnnxDiarizer({ ...config, clusteringThreshold: 0.8 }, factory).diarize({
      wavPath,
      maxSpeakers: 6
    })

    expect(factory.calls[0]?.clusteringThreshold).toBe(0.8)
  })

  it('16bit PCM を [-1, 1] の Float32 に正規化して渡す', async () => {
    const session = new FakeSession()
    const factory = new FakeFactory(session)
    const wavPath = await writeWav('b.wav', [0, 32_767, -32_768])

    await new SherpaOnnxDiarizer(config, factory).diarize({ wavPath, maxSpeakers: 6 })

    expect(session.received).toBeInstanceOf(Float32Array)
    expect([...(session.received ?? [])]).toEqual([0, 32_767 / 32_768, -1])
  })

  it('話者数を上限まで絞る', async () => {
    const session = new FakeSession([
      { start: 0, end: 10, speaker: 0 },
      { start: 10, end: 15, speaker: 1 },
      { start: 15, end: 15.2, speaker: 2 }
    ])
    const wavPath = await writeWav('c.wav', [1, 2, 3])

    const turns = await new SherpaOnnxDiarizer(config, new FakeFactory(session)).diarize({
      wavPath,
      maxSpeakers: 2
    })

    expect(turns.map((turn) => turn.speaker)).toEqual(['spk0', 'spk1'])
  })

  it('モデルが要求するサンプルレートと違う録音は推論せずに拒否する', async () => {
    const factory = new FakeFactory(new FakeSession([], 16_000))
    const wavPath = await writeWav('d.wav', [1, 2, 3], 48_000)

    await expect(new SherpaOnnxDiarizer(config, factory).diarize({ wavPath, maxSpeakers: 6 })).rejects.toMatchObject({
      reason: { code: 'diarizationSampleRate', modelRate: 16_000, recordingRate: 48_000 }
    })
    expect(factory.session.received).toBeUndefined()
  })

  it('推論が失敗してもセッションを解放する', async () => {
    const session = new FakeSession()
    session.error = new Error('boom')
    const wavPath = await writeWav('e.wav', [1, 2, 3])

    await expect(
      new SherpaOnnxDiarizer(config, new FakeFactory(session)).diarize({ wavPath, maxSpeakers: 6 })
    ).rejects.toBeInstanceOf(DiarizationError)
    expect(session.disposed).toBe(1)
  })

  it('成功時もセッションを解放する', async () => {
    const session = new FakeSession()
    const wavPath = await writeWav('f.wav', [1, 2, 3])

    await new SherpaOnnxDiarizer(config, new FakeFactory(session)).diarize({
      wavPath,
      maxSpeakers: 6
    })

    expect(session.disposed).toBe(1)
  })
})
