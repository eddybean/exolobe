import { execFile } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AfconvertEncoder } from '@infrastructure/audio/AfconvertEncoder'
import { WavFileWriter, int16Buffer } from '@infrastructure/audio/wav'
import { notMacOS } from '../platform'

const SAMPLE_RATE = 16_000

let dir: string
let encoder: AfconvertEncoder

/** サイン波。無音だと圧縮率が極端になり比較の意味が薄れるため。 */
const tone = (seconds: number): number[] =>
  Array.from({ length: SAMPLE_RATE * seconds }, (_, i) =>
    Math.round(12_000 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE))
  )

/**
 * 帯域制限ノイズ。afconvert の `-s 3` は厳密な CBR ではなく、純音のような単純な
 * 信号では目標より大幅に少ないビットしか使わない。ビットレートの検証には音声に
 * 近い複雑さを持つ信号が必要になる。
 */
const bandLimitedNoise = (seconds: number): number[] => {
  let seed = 1
  let previous = 0
  return Array.from({ length: SAMPLE_RATE * seconds }, () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
    const white = (seed / 2_147_483_648) * 16_000 - 8_000
    previous = Math.round(0.7 * previous + 0.3 * white)
    return previous
  })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omr-enc-'))
  encoder = new AfconvertEncoder()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe.skipIf(notMacOS)('AfconvertEncoder', () => {
  it('WAV を AAC-LC の m4a へ変換し、大幅に小さくする', async () => {
    const input = join(dir, 'mix.wav')
    const output = join(dir, 'nested', 'audio.m4a')

    const writer = await WavFileWriter.create(input, { sampleRate: SAMPLE_RATE })
    await writer.write(int16Buffer(tone(10)))
    await writer.close()

    await encoder.encode({ inputPath: input, outputPath: output, codec: 'aac', bitrateKbps: 32 })

    const wavSize = (await stat(input)).size
    const m4aSize = (await stat(output)).size

    expect(m4aSize).toBeGreaterThan(0)
    // 16bit 16kHz PCM は 256kbps。32kbps 目標なので 1/4 以下にはなるはず。
    expect(m4aSize).toBeLessThan(wavSize / 4)
  }, 30_000)

  it('AAC-LC は入力のサンプルレートと指定ビットレートを維持する', async () => {
    const input = join(dir, 'mix.wav')
    const output = join(dir, 'audio.m4a')

    const writer = await WavFileWriter.create(input, { sampleRate: SAMPLE_RATE })
    await writer.write(int16Buffer(bandLimitedNoise(10)))
    await writer.close()

    await encoder.encode({ inputPath: input, outputPath: output, codec: 'aac', bitrateKbps: 32 })

    // HE-AAC (aach) を指定するとコアが 8kHz へ落ち -b も無視されるため、
    // 会議音声の既定である AAC-LC がその挙動をしないことを固定する。
    const info = await promisify(execFile)('/usr/bin/afinfo', [output])
    expect(info.stdout).toContain('16000 Hz')

    const kbps = ((await stat(output)).size * 8) / 10 / 1000
    expect(kbps).toBeGreaterThan(24)
    expect(kbps).toBeLessThan(40)
  }, 30_000)

  it('入力が存在しなければ利用者向けメッセージで失敗する', async () => {
    await expect(
      encoder.encode({
        inputPath: join(dir, 'missing.wav'),
        outputPath: join(dir, 'out.m4a'),
        codec: 'aac',
        bitrateKbps: 32
      })
    ).rejects.toThrow('encodeFailed')
  }, 30_000)
})
