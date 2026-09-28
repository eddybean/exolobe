import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TrackMixer } from '@infrastructure/audio/TrackMixer'
import { WavFileWriter, int16Buffer, readWav } from '@infrastructure/audio/wav'

const SAMPLE_RATE = 16_000

let dir: string
let mixer: TrackMixer

const writeTrack = async (name: string, samples: readonly number[]): Promise<string> => {
  const path = join(dir, name)
  const writer = await WavFileWriter.create(path, { sampleRate: SAMPLE_RATE })
  await writer.write(int16Buffer(samples))
  await writer.close()
  return path
}

const readSamples = async (path: string): Promise<number[]> => [...(await readWav(path)).samples]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omr-mix-'))
  mixer = new TrackMixer()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('TrackMixer', () => {
  it('オフセット 0 の 2 トラックをサンプル単位で加算する', async () => {
    const a = await writeTrack('a.wav', [100, 200, 300])
    const b = await writeTrack('b.wav', [1, 2, 3])
    const out = join(dir, 'mix.wav')

    await mixer.mix({
      tracks: [
        { path: a, offsetMs: 0 },
        { path: b, offsetMs: 0 }
      ],
      outputPath: out
    })

    expect(await readSamples(out)).toEqual([101, 202, 303])
  })

  it('オフセット分だけ後ろのトラックをずらす', async () => {
    const a = await writeTrack('a.wav', [10, 10, 10, 10])
    // 1ms = 16 サンプル
    const b = await writeTrack('b.wav', [5, 5])
    const out = join(dir, 'mix.wav')

    await mixer.mix({
      tracks: [
        { path: a, offsetMs: 0 },
        { path: b, offsetMs: 1 }
      ],
      outputPath: out
    })

    const mixed = await readSamples(out)
    expect(mixed.slice(0, 4)).toEqual([10, 10, 10, 10])
    expect(mixed.slice(16, 18)).toEqual([5, 5])
    expect(mixed).toHaveLength(18)
  })

  it('負のオフセット（先行して開始したトラック）は 0 として扱う', async () => {
    const a = await writeTrack('a.wav', [7, 7])
    const out = join(dir, 'mix.wav')

    await mixer.mix({ tracks: [{ path: a, offsetMs: -50 }], outputPath: out })

    expect(await readSamples(out)).toEqual([7, 7])
  })

  it('加算が範囲を超えてもクリッピングして歪ませない', async () => {
    const a = await writeTrack('a.wav', [30_000, -30_000])
    const b = await writeTrack('b.wav', [30_000, -30_000])
    const out = join(dir, 'mix.wav')

    await mixer.mix({
      tracks: [
        { path: a, offsetMs: 0 },
        { path: b, offsetMs: 0 }
      ],
      outputPath: out
    })

    expect(await readSamples(out)).toEqual([32_767, -32_768])
  })

  it('長さの異なるトラックは最も長い方に合わせる', async () => {
    const a = await writeTrack('a.wav', [1, 1, 1, 1, 1])
    const b = await writeTrack('b.wav', [2, 2])
    const out = join(dir, 'mix.wav')

    const result = await mixer.mix({
      tracks: [
        { path: a, offsetMs: 0 },
        { path: b, offsetMs: 0 }
      ],
      outputPath: out
    })

    expect(await readSamples(out)).toEqual([3, 3, 1, 1, 1])
    expect(result.durationMs).toBe(Math.round((5 / SAMPLE_RATE) * 1000))
  })

  it('空トラックが混ざっても他トラックをそのまま出力する', async () => {
    const a = await writeTrack('a.wav', [9, 9])
    const empty = await writeTrack('empty.wav', [])
    const out = join(dir, 'mix.wav')

    await mixer.mix({
      tracks: [
        { path: a, offsetMs: 0 },
        { path: empty, offsetMs: 0 }
      ],
      outputPath: out
    })

    expect(await readSamples(out)).toEqual([9, 9])
  })

  it('サンプルレートが混在していたら明示的に失敗する', async () => {
    const a = await writeTrack('a.wav', [1])
    const bPath = join(dir, 'b.wav')
    const writer = await WavFileWriter.create(bPath, { sampleRate: 48_000 })
    await writer.write(int16Buffer([1]))
    await writer.close()

    await expect(
      mixer.mix({
        tracks: [
          { path: a, offsetMs: 0 },
          { path: bPath, offsetMs: 0 }
        ],
        outputPath: join(dir, 'mix.wav')
      })
    ).rejects.toThrow('mixSampleRateMismatch')
  })

  it('トラックが 1 つも無ければ失敗する', async () => {
    await expect(mixer.mix({ tracks: [], outputPath: join(dir, 'mix.wav') })).rejects.toThrow(
      'mixNoTracks'
    )
  })
})
