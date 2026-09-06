import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WavFileWriter, durationMsForPcm, int16Buffer, readWav } from '@infrastructure/audio/wav'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omr-wav-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('WavFileWriter', () => {
  it('16bit モノラルの WAV ヘッダを書き、読み戻せる', async () => {
    const path = join(dir, 'a.wav')
    const writer = await WavFileWriter.create(path, { sampleRate: 16_000 })
    await writer.write(int16Buffer([0, 1000, -1000, 32767]))
    const result = await writer.close()

    const wav = await readWav(path)
    expect(wav.sampleRate).toBe(16_000)
    expect(wav.channels).toBe(1)
    expect(wav.bitsPerSample).toBe(16)
    expect([...wav.samples]).toEqual([0, 1000, -1000, 32767])
    expect(result.durationMs).toBe(durationMsForPcm(4, 16_000))
  })

  it('close 時にヘッダのサイズを実際の書き込み量へ更新する', async () => {
    const path = join(dir, 'b.wav')
    const writer = await WavFileWriter.create(path, { sampleRate: 16_000 })
    await writer.write(int16Buffer(new Array(800).fill(123)))
    await writer.close()

    const raw = await readFile(path)
    // RIFF チャンクサイズ = ファイル全体 - 8
    expect(raw.readUInt32LE(4)).toBe(raw.length - 8)
    // data チャンクサイズ = PCM バイト数
    expect(raw.readUInt32LE(40)).toBe(1600)
  })

  it('複数回に分けて書いても連結される', async () => {
    const path = join(dir, 'c.wav')
    const writer = await WavFileWriter.create(path, { sampleRate: 16_000 })
    await writer.write(int16Buffer([1, 2]))
    await writer.write(int16Buffer([3, 4]))
    await writer.close()

    expect([...(await readWav(path)).samples]).toEqual([1, 2, 3, 4])
  })

  it('1 サンプルも書かれなくても壊れた WAV を残さない', async () => {
    const path = join(dir, 'empty.wav')
    const writer = await WavFileWriter.create(path, { sampleRate: 16_000 })
    const result = await writer.close()

    expect(result.durationMs).toBe(0)
    expect([...(await readWav(path)).samples]).toEqual([])
  })
})

describe('readWav', () => {
  it('WAV でないファイルは明示的に失敗する', async () => {
    const path = join(dir, 'not-a.wav')
    await (await WavFileWriter.create(join(dir, 'tmp.wav'), { sampleRate: 16_000 })).close()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path, Buffer.from('this is not a wav file'))

    await expect(readWav(path)).rejects.toThrow('WAV ファイルとして読み取れません')
  })
})

describe('durationMsForPcm', () => {
  it('サンプル数とサンプルレートから長さを求める', () => {
    expect(durationMsForPcm(16_000, 16_000)).toBe(1000)
    expect(durationMsForPcm(0, 16_000)).toBe(0)
  })
})
