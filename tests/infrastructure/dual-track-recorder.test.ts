import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DualTrackRecorder, type SystemAudioSource } from '@infrastructure/audio/DualTrackRecorder'
import { int16Buffer, readWav } from '@infrastructure/audio/wav'

class FakeSystemAudioSource implements SystemAudioSource {
  started: { sampleRate: number }[] = []
  stopped = 0
  startError?: Error
  private dataListener: (pcm: Buffer) => void = () => {}
  private errorListener: (error: Error) => void = () => {}

  async start(params: { sampleRate: number }): Promise<void> {
    if (this.startError) throw this.startError
    this.started.push(params)
  }
  async stop(): Promise<void> {
    this.stopped += 1
  }
  onData(listener: (pcm: Buffer) => void): void {
    this.dataListener = listener
  }
  onError(listener: (error: Error) => void): void {
    this.errorListener = listener
  }
  emit(samples: readonly number[]): void {
    this.dataListener(int16Buffer(samples))
  }
  emitError(error: Error): void {
    this.errorListener(error)
  }
}

/** テスト内で時間を明示的に進めるための時計。 */
class ManualClock {
  private value = 0
  readonly now = (): number => this.value
  advance(ms: number): void {
    this.value += ms
  }
}

let dir: string
let source: FakeSystemAudioSource
let clock: ManualClock
let recorder: DualTrackRecorder

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omr-rec-'))
  source = new FakeSystemAudioSource()
  clock = new ManualClock()
  recorder = new DualTrackRecorder(source, clock.now)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const start = (): Promise<void> => recorder.start({ workDir: dir, sampleRate: 16_000 })

describe('DualTrackRecorder', () => {
  it('システム音声とマイクを別々の WAV に書き分ける', async () => {
    await start()
    source.emit([1, 2, 3])
    await recorder.pushMicPcm(int16Buffer([9, 9]))
    const tracks = await recorder.stop()

    expect([...(await readWav(tracks.systemWavPath)).samples]).toEqual([1, 2, 3])
    expect([...(await readWav(tracks.micWavPath)).samples]).toEqual([9, 9])
  })

  it('設定のサンプルレートで音声ソースを開始する', async () => {
    await start()
    expect(source.started).toEqual([{ sampleRate: 16_000 }])
    await recorder.stop()
  })

  it('最初の PCM が届いた時刻の差をマイクのオフセットにする', async () => {
    await start()
    source.emit([1])
    clock.advance(120)
    await recorder.pushMicPcm(int16Buffer([1]))

    expect((await recorder.stop()).micOffsetMs).toBe(120)
  })

  it('2 回目以降の PCM ではオフセットを更新しない', async () => {
    await start()
    source.emit([1])
    clock.advance(50)
    await recorder.pushMicPcm(int16Buffer([1]))
    clock.advance(5_000)
    await recorder.pushMicPcm(int16Buffer([1]))
    source.emit([1])

    expect((await recorder.stop()).micOffsetMs).toBe(50)
  })

  it('マイクが無音のままならオフセットは 0 にする', async () => {
    await start()
    source.emit([1])
    clock.advance(300)

    expect((await recorder.stop()).micOffsetMs).toBe(0)
  })

  it('長い方のトラックの長さを録音時間とする', async () => {
    await start()
    source.emit(new Array(16_000).fill(1)) // 1 秒
    await recorder.pushMicPcm(int16Buffer([1, 1]))

    expect((await recorder.stop()).durationMs).toBe(1000)
  })

  it('停止後に届いた PCM は書き込まない', async () => {
    await start()
    source.emit([1])
    const tracks = await recorder.stop()

    source.emit([2, 2, 2])
    await recorder.pushMicPcm(int16Buffer([3, 3]))

    expect([...(await readWav(tracks.systemWavPath)).samples]).toEqual([1])
    expect([...(await readWav(tracks.micWavPath)).samples]).toEqual([])
  })

  it('録音中は isActive が true になる', async () => {
    expect(recorder.isActive()).toBe(false)
    await start()
    expect(recorder.isActive()).toBe(true)
    await recorder.stop()
    expect(recorder.isActive()).toBe(false)
  })

  it('二重の開始を拒否する', async () => {
    await start()
    await expect(start()).rejects.toThrow('すでに録音中です。')
    await recorder.stop()
  })

  it('録音していないのに停止したら失敗する', async () => {
    await expect(recorder.stop()).rejects.toThrow('録音中ではありません。')
  })

  it('音声ソースの開始に失敗したら録音状態を残さない', async () => {
    source.startError = new Error('システム音声の録音が許可されていません。')

    await expect(start()).rejects.toThrow('システム音声の録音が許可されていません。')
    expect(recorder.isActive()).toBe(false)
  })

  it('システム音声が 1 サンプルも取れずエラーが出ていたら停止時に報告する', async () => {
    await start()
    source.emitError(new Error('オーディオデバイスが変更されました。'))

    await expect(recorder.stop()).rejects.toThrow('オーディオデバイスが変更されました。')
  })

  it('音声が取れていればソース側のエラーは録音を捨てる理由にしない', async () => {
    await start()
    source.emit([1, 2])
    source.emitError(new Error('一時的な警告'))

    await expect(recorder.stop()).resolves.toMatchObject({ durationMs: 0 })
  })

  it('システム音声のレベルは直近に届いた PCM の peak を 0〜1 で返す', async () => {
    await start()
    source.emit([0, 16_384, -8_192])

    expect(recorder.systemLevel()).toBeCloseTo(0.5, 5)
  })

  it('読み出したレベルは持ち越さない（音が止まればメーターも落ちる）', async () => {
    await start()
    source.emit([32_767])
    recorder.systemLevel()

    expect(recorder.systemLevel()).toBe(0)
  })

  it('読み出しの間に複数の PCM が届いたら最大値を返す', async () => {
    await start()
    source.emit([1_000])
    source.emit([16_384])
    source.emit([2_000])

    expect(recorder.systemLevel()).toBeCloseTo(0.5, 5)
  })

  it('録音していないときのレベルは 0 とする', async () => {
    expect(recorder.systemLevel()).toBe(0)
    await start()
    source.emit([32_767])
    await recorder.stop()

    expect(recorder.systemLevel()).toBe(0)
  })

  it('停止すると音声ソースも止める', async () => {
    await start()
    await recorder.stop()
    expect(source.stopped).toBe(1)
  })
})
