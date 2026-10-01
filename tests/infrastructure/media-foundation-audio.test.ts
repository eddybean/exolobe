import { existsSync } from 'node:fs'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '@domain/errors'
import { MediaFoundationDecoder } from '@infrastructure/audio/MediaFoundationDecoder'
import { MediaFoundationEncoder, type RunAudioConv } from '@infrastructure/audio/MediaFoundationEncoder'
import { WavFileWriter, int16Buffer, readWav } from '@infrastructure/audio/wav'
import { notWindows } from '../platform'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'media-foundation-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const BINARY = 'C:/bin/audioconv.exe'

/** 呼ばれた引数を覚え、指定の振る舞いをする audioconv の代わり。 */
const fakeRun = (behave: (args: readonly string[]) => Promise<void> = async () => {}) => {
  const calls: { file: string; args: readonly string[] }[] = []
  const run: RunAudioConv = async (file, args) => {
    calls.push({ file, args })
    await behave(args)
    return { stdout: '', stderr: '' }
  }
  return { run, calls }
}

/** execFile の失敗と同じ形（stderr を持つ Error）。 */
const failure = (stderr: string): Error => Object.assign(new Error('Command failed'), { stderr })

const reasonOf = (error: unknown): unknown => (error instanceof AppError ? error.reason : error)

const writeMono = async (path: string, samples: readonly number[], sampleRate = 16_000): Promise<void> => {
  const writer = await WavFileWriter.create(path, { sampleRate })
  await writer.write(int16Buffer(samples))
  await writer.close()
}

describe('MediaFoundationEncoder', () => {
  it('入力と出力とビットレート（bps）を渡して audioconv の encode を呼ぶ', async () => {
    const { run, calls } = fakeRun()
    const encoder = new MediaFoundationEncoder(BINARY, run)

    await encoder.encode({ inputPath: 'in.wav', outputPath: join(dir, 'audio.m4a'), codec: 'aac', bitrateKbps: 32 })

    expect(calls).toEqual([
      {
        file: BINARY,
        args: ['encode', '--input', 'in.wav', '--output', join(dir, 'audio.m4a'), '--bitrate', '32000']
      }
    ])
  })

  it('出力先のディレクトリが無ければ作る', async () => {
    const { run } = fakeRun()
    const output = join(dir, 'nested', 'audio.m4a')

    await new MediaFoundationEncoder(BINARY, run).encode({
      inputPath: 'in.wav',
      outputPath: output,
      codec: 'aac',
      bitrateKbps: 32
    })

    expect((await stat(join(dir, 'nested'))).isDirectory()).toBe(true)
  })

  it('HE-AAC を求められても AAC-LC で保存する（macOS から持ち込んだ設定でも保存を止めない）', async () => {
    const { run, calls } = fakeRun()

    await new MediaFoundationEncoder(BINARY, run).encode({
      inputPath: 'in.wav',
      outputPath: join(dir, 'audio.m4a'),
      codec: 'aach',
      bitrateKbps: 32
    })

    expect(calls[0]?.args).toEqual([
      'encode',
      '--input',
      'in.wav',
      '--output',
      join(dir, 'audio.m4a'),
      '--bitrate',
      '32000'
    ])
  })

  it('失敗したら audioconv の stderr を理由に添える', async () => {
    const { run } = fakeRun(async () => {
      throw failure('audioconv: open: 0xC00D36C4  ')
    })

    const error = await new MediaFoundationEncoder(BINARY, run)
      .encode({ inputPath: 'in.wav', outputPath: join(dir, 'audio.m4a'), codec: 'aac', bitrateKbps: 32 })
      .catch((e: unknown) => e)

    expect(reasonOf(error)).toEqual({ code: 'encodeFailed', detail: 'audioconv: open: 0xC00D36C4' })
  })

  it('同梱バイナリが無ければ、呼ばずに理由付きで失敗する', async () => {
    const { run, calls } = fakeRun()

    const error = await new MediaFoundationEncoder(undefined, run)
      .encode({ inputPath: 'in.wav', outputPath: join(dir, 'audio.m4a'), codec: 'aac', bitrateKbps: 32 })
      .catch((e: unknown) => e)

    expect(reasonOf(error)).toMatchObject({ code: 'encodeFailed' })
    expect(calls).toEqual([])
  })
})

describe('MediaFoundationDecoder', () => {
  it('指定のレートで audioconv の decode を呼び、書かれた WAV の長さを返す', async () => {
    const output = join(dir, 'imported.wav')
    const { run, calls } = fakeRun(async () => writeMono(output, new Array(16_000).fill(0)))

    const result = await new MediaFoundationDecoder(BINARY, run).decode({
      inputPath: 'C:/x/会議.mp3',
      outputPath: output,
      sampleRate: 16_000
    })

    expect(calls[0]?.args).toEqual(['decode', '--input', 'C:/x/会議.mp3', '--output', output, '--sample-rate', '16000'])
    expect(result).toEqual({ durationMs: 1_000 })
  })

  it('失敗したらファイル名を添えて断り、途中まで書かれた出力を残さない', async () => {
    const output = join(dir, 'nested', 'imported.wav')
    const { run } = fakeRun(async () => {
      await writeFile(output, 'partial')
      throw failure('audioconv: read: 0x80004005')
    })

    const error = await new MediaFoundationDecoder(BINARY, run)
      .decode({ inputPath: 'C:/x/会議.mp3', outputPath: output, sampleRate: 16_000 })
      .catch((e: unknown) => e)

    expect(reasonOf(error)).toEqual({ code: 'decodeFailed', fileName: '会議.mp3' })
    expect(existsSync(output)).toBe(false)
  })

  it('同梱バイナリが無ければ、呼ばずに読み取れなかったと断る', async () => {
    const { run, calls } = fakeRun()

    const error = await new MediaFoundationDecoder(undefined, run)
      .decode({ inputPath: 'C:/x/会議.mp3', outputPath: join(dir, 'imported.wav'), sampleRate: 16_000 })
      .catch((e: unknown) => e)

    expect(reasonOf(error)).toMatchObject({ code: 'decodeFailed', fileName: '会議.mp3' })
    expect(calls).toEqual([])
  })
})

/** 440Hz の正弦波（振幅 12000）。 */
const tone = (seconds: number, sampleRate = 16_000): number[] =>
  Array.from({ length: seconds * sampleRate }, (_, i) =>
    Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12_000)
  )

/** 左右で違う音を入れた 44.1kHz のステレオ WAV。片チャンネルを捨てると片方の音が消える。 */
const writeStereo = async (path: string, seconds: number): Promise<void> => {
  const rate = 44_100
  const samples: number[] = []
  for (let i = 0; i < seconds * rate; i++) {
    samples.push(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8_000))
    samples.push(Math.round(Math.sin((2 * Math.PI * 1_000 * i) / rate) * 8_000))
  }
  const writer = await WavFileWriter.create(path, { sampleRate: rate, channels: 2 })
  await writer.write(int16Buffer(samples))
  await writer.close()
}

/** 指定の周波数の成分の振幅（0〜1）。 */
const amplitudeAt = (samples: Int16Array, sampleRate: number, hz: number): number => {
  const k = 2 * Math.cos((2 * Math.PI * hz) / sampleRate)
  let s1 = 0
  let s2 = 0
  for (const sample of samples) {
    const s = sample / 32_768 + k * s1 - s2
    s2 = s1
    s1 = s
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2) / (samples.length / 2)
}

/**
 * 実物の audioconv.exe（`npm run build:audioconv` で resources/bin に作る）を通す。
 * afconvert のテストと同じ観点で、Windows でだけ走らせる。
 */
const audioconv = join(process.cwd(), 'resources', 'bin', 'audioconv.exe')

describe.skipIf(notWindows || !existsSync(audioconv))('Media Foundation（実機）', () => {
  it('WAV を AAC-LC の m4a へ変換し、大幅に小さくする', async () => {
    const input = join(dir, 'in.wav')
    const output = join(dir, 'nested', 'audio.m4a')
    await writeMono(input, tone(10))

    await new MediaFoundationEncoder(audioconv).encode({
      inputPath: input,
      outputPath: output,
      codec: 'aac',
      bitrateKbps: 32
    })

    const wavSize = (await stat(input)).size
    const m4aSize = (await stat(output)).size
    expect(m4aSize).toBeGreaterThan(0)
    expect(m4aSize).toBeLessThan(wavSize / 4)
  }, 30_000)

  it('エンコードした m4a を読み直すと、指定のビットレートと長さと音を保っている', async () => {
    const input = join(dir, 'in.wav')
    const encoded = join(dir, 'audio.m4a')
    const decoded = join(dir, 'decoded.wav')
    await writeMono(input, tone(10))

    await new MediaFoundationEncoder(audioconv).encode({
      inputPath: input,
      outputPath: encoded,
      codec: 'aac',
      bitrateKbps: 32
    })
    const { durationMs } = await new MediaFoundationDecoder(audioconv).decode({
      inputPath: encoded,
      outputPath: decoded,
      sampleRate: 16_000
    })

    // 指定のビットレート（32kbps）どおりなら 10 秒で約 40KB。
    const kbps = ((await stat(encoded)).size * 8) / 10 / 1000
    expect(kbps).toBeGreaterThan(24)
    expect(kbps).toBeLessThan(40)
    expect(durationMs).toBeGreaterThan(9_900)
    expect(durationMs).toBeLessThan(10_200)
    const wav = await readWav(decoded)
    expect(amplitudeAt(wav.samples, wav.sampleRate, 440)).toBeGreaterThan(0.2)
  }, 30_000)

  it('44.1kHz ステレオを 16kHz モノラル 16bit にし、左右どちらの音も残す', async () => {
    const input = join(dir, 'stereo.wav')
    const output = join(dir, 'nested', 'imported.wav')
    await writeStereo(input, 1)

    const { durationMs } = await new MediaFoundationDecoder(audioconv).decode({
      inputPath: input,
      outputPath: output,
      sampleRate: 16_000
    })

    const wav = await readWav(output)
    expect({ sampleRate: wav.sampleRate, channels: wav.channels, bitsPerSample: wav.bitsPerSample }).toEqual({
      sampleRate: 16_000,
      channels: 1,
      bitsPerSample: 16
    })
    expect(durationMs).toBeGreaterThan(900)
    expect(durationMs).toBeLessThan(1_100)
    expect(amplitudeAt(wav.samples, 16_000, 440)).toBeGreaterThan(0.05)
    expect(amplitudeAt(wav.samples, 16_000, 1_000)).toBeGreaterThan(0.05)
  }, 30_000)

  it('中身が音声でないファイルは失敗し、出力を残さない', async () => {
    const input = join(dir, 'broken.mp3')
    const output = join(dir, 'imported.wav')
    await writeFile(input, 'this is not audio')

    const error = await new MediaFoundationDecoder(audioconv)
      .decode({ inputPath: input, outputPath: output, sampleRate: 16_000 })
      .catch((e: unknown) => e)

    expect(reasonOf(error)).toEqual({ code: 'decodeFailed', fileName: 'broken.mp3' })
    expect(existsSync(output)).toBe(false)
    expect(existsSync(`${output}.part`)).toBe(false)
  }, 30_000)
})
