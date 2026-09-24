import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AfconvertDecoder } from '@infrastructure/audio/AfconvertDecoder'
import { AfconvertEncoder } from '@infrastructure/audio/AfconvertEncoder'
import { WavFileWriter, int16Buffer, readWav } from '@infrastructure/audio/wav'

const TARGET_RATE = 16_000

let dir: string
let decoder: AfconvertDecoder

/** 話し声に近い複雑さを持つ信号。無音だと変換結果の確認が意味を持たない。 */
const speechLike = (samples: number): number[] => {
  let seed = 11
  let previous = 0
  return Array.from({ length: samples }, () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
    const white = (seed / 2_147_483_648) * 12_000 - 6_000
    previous = Math.round(0.75 * previous + 0.25 * white)
    return previous
  })
}

/** インターリーブした 2ch の WAV を書く。左右で違う音を入れ、ダウンミックスを確かめられる形にする。 */
const writeStereo = async (name: string, seconds: number, sampleRate: number): Promise<string> => {
  const path = join(dir, name)
  const writer = await WavFileWriter.create(path, { sampleRate, channels: 2 })
  const left = speechLike(sampleRate * seconds)
  const interleaved: number[] = []
  for (const sample of left) {
    interleaved.push(sample, Math.round(sample * 0.5))
  }
  await writer.write(int16Buffer(interleaved))
  await writer.close()
  return path
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omr-dec-'))
  decoder = new AfconvertDecoder()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('AfconvertDecoder', () => {
  it('44.1kHz ステレオを 16kHz モノラル 16bit の WAV にする', async () => {
    const input = await writeStereo('src.wav', 1, 44_100)
    const output = join(dir, 'nested', 'imported.wav')

    const result = await decoder.decode({ inputPath: input, outputPath: output, sampleRate: TARGET_RATE })

    const wav = await readWav(output)
    expect(wav.sampleRate).toBe(TARGET_RATE)
    expect(wav.channels).toBe(1)
    expect(wav.bitsPerSample).toBe(16)
    // リサンプラの都合で端数が出るため、1 秒ぶんに近いことだけを見る。
    expect(wav.samples.length).toBeGreaterThan(TARGET_RATE * 0.9)
    expect(result.durationMs).toBeGreaterThan(900)
    expect(result.durationMs).toBeLessThan(1_100)
  }, 30_000)

  /**
   * 出力と同じ 16kHz モノラル 16bit の WAV に `--mix` を付けると、afconvert は
   * 「Couldn't set audio converter property (-50)」で失敗する。文字起こし用に書き出した
   * 音声をそのまま取り込む利用者は多いので、変換が要らない入力こそ通らないといけない。
   */
  it('既に 16kHz モノラル 16bit の WAV もそのまま読める', async () => {
    const input = join(dir, 'mono16k.wav')
    const writer = await WavFileWriter.create(input, { sampleRate: TARGET_RATE, channels: 1 })
    await writer.write(int16Buffer(speechLike(TARGET_RATE)))
    await writer.close()
    const output = join(dir, 'imported.wav')

    const result = await decoder.decode({ inputPath: input, outputPath: output, sampleRate: TARGET_RATE })

    const wav = await readWav(output)
    expect(wav.sampleRate).toBe(TARGET_RATE)
    expect(wav.channels).toBe(1)
    expect(wav.samples.length).toBe(TARGET_RATE)
    expect(result.durationMs).toBe(1_000)
  }, 30_000)

  it('エンコード済みの m4a も読める（配布用と同じ形式で往復できる）', async () => {
    const source = await writeStereo('src.wav', 1, TARGET_RATE)
    const m4a = join(dir, 'audio.m4a')
    await new AfconvertEncoder().encode({
      inputPath: source,
      outputPath: m4a,
      codec: 'aac',
      bitrateKbps: 32
    })

    const output = join(dir, 'imported.wav')
    await decoder.decode({ inputPath: m4a, outputPath: output, sampleRate: TARGET_RATE })

    expect((await readWav(output)).sampleRate).toBe(TARGET_RATE)
  }, 30_000)

  it('存在しない入力は利用者向けメッセージで失敗し、出力を残さない', async () => {
    const output = join(dir, 'imported.wav')

    await expect(
      decoder.decode({ inputPath: join(dir, 'missing.mp3'), outputPath: output, sampleRate: TARGET_RATE })
    ).rejects.toThrow('読み取れませんでした')
    await expect(stat(output)).rejects.toThrow()
  }, 30_000)

  /** 拡張子だけでは見抜けない「中身が音声でないファイル」はここで初めて分かる。 */
  it('中身が音声でないファイルは失敗し、出力を残さない', async () => {
    const input = join(dir, 'broken.mp3')
    await writeFile(input, 'this is not audio', 'utf8')
    const output = join(dir, 'imported.wav')

    await expect(
      decoder.decode({ inputPath: input, outputPath: output, sampleRate: TARGET_RATE })
    ).rejects.toThrow('broken.mp3')
    await expect(stat(output)).rejects.toThrow()
  }, 30_000)
})
