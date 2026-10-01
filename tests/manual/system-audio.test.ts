/**
 * システム音声が実機で録れることを確かめる。`npm run test:manual` でだけ走る。
 *
 * CI から外してあるのは、Core Audio Process Tap の権限（TCC）と鳴っている音の
 * 両方が要るため。GitHub の macOS ランナーはどちらも持たないので必ず落ちる。
 *
 * audiotee や Electron を上げたあと、ユニットテストでは触れない
 * 「Tap から PCM が届くか」をここで見る。マイクは押し込まないので mic.wav は
 * ヘッダだけになり、マイクの無い環境（ADR-017）と同じ形で終わる。
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AudioTeeSource } from '@infrastructure/audio/AudioTeeSource'
import { DualTrackRecorder, peakOf } from '@infrastructure/audio/DualTrackRecorder'
import { SysCaptureSource } from '@infrastructure/audio/SysCaptureSource'
import { int16Buffer } from '@infrastructure/audio/wav'
import { notMacOS, notWindows } from '../platform'

const SAMPLE_RATE = 16_000
const CAPTURE_MS = 6_000

/** WAV ヘッダの長さ。本体が空かどうかの判定に使う。 */
const WAV_HEADER_BYTES = 44

/** 無音との区別がつく下限。環境ノイズではなく、鳴らした音だけが超える。 */
const AUDIBLE_PEAK = 0.001

/**
 * 録る対象の音を鳴らす。OS に必ずある効果音を繰り返すので、
 * 音源ファイルを用意しなくても、どの Mac でもそのまま走る。
 */
const playSound = (): (() => void) => {
  const child = spawn('/bin/sh', ['-c', 'for i in 1 2 3 4 5 6; do afplay /System/Library/Sounds/Ping.aiff; done'])
  return () => child.kill()
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe.skipIf(notMacOS)('システム音声の取得（実機・macOS）', () => {
  it('audiotee から PCM が届き、無音でない system.wav ができる', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'omr-syscheck-'))
    const recorder = new DualTrackRecorder(new AudioTeeSource())

    const peaks: number[] = []
    recorder.onPeak((peak) => {
      peaks.push(peak)
    })

    await recorder.start({ workDir, sampleRate: SAMPLE_RATE })
    const stopSound = playSound()
    await wait(CAPTURE_MS)
    stopSound()
    const source = await recorder.stop()

    const body = (await readFile(source.systemWavPath)).subarray(WAV_HEADER_BYTES)
    const micBytes = (await stat(source.micWavPath)).size

    // 失敗したときに「届かなかった」のか「無音だった」のかが分かるよう、
    // 判定に使った値をそのまま残す。
    console.log({
      durationMs: source.durationMs,
      systemBytes: body.length,
      systemPeak: Math.max(0, ...peaks),
      chunks: peaks.length,
      micBytes
    })

    expect(body.length).toBeGreaterThan(0)
    expect(peakOf(body)).toBeGreaterThan(AUDIBLE_PEAK)

    // 尺が録音時間とずれていたら、書き込みを取りこぼしている。
    const expectedBytes = (CAPTURE_MS / 1000) * SAMPLE_RATE * 2
    expect(body.length).toBeGreaterThan(expectedBytes * 0.8)

    expect(micBytes).toBe(WAV_HEADER_BYTES)
  }, 30_000)
})

/** 1 kHz の正弦波。背景で鳴っている音（ブラウザなど）と切り分けるため、この周波数の成分だけを測る。 */
const TONE_HZ = 1_000

/** 0.1 秒ごとに 1 kHz の成分の振幅を求め、最大値を返す（Goertzel 法）。 */
const toneAmplitude = (pcm: Buffer, sampleRate: number): number => {
  const block = sampleRate / 10
  const k = 2 * Math.cos((2 * Math.PI * TONE_HZ) / sampleRate)
  let best = 0
  for (let start = 0; (start + block) * 2 <= pcm.length; start += block) {
    let s1 = 0
    let s2 = 0
    for (let i = 0; i < block; i++) {
      const s = pcm.readInt16LE((start + i) * 2) / 32768 + k * s1 - s2
      s2 = s1
      s1 = s
    }
    best = Math.max(best, Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2) / (block / 2))
  }
  return best
}

/** 振幅 0.5・2 秒の 1 kHz の WAV を書く。 */
const writeTone = async (path: string): Promise<void> => {
  const rate = 48_000
  const samples = Array.from({ length: rate * 2 }, (_, i) =>
    Math.round(Math.sin((2 * Math.PI * TONE_HZ * i) / rate) * 16_384)
  )
  const body = int16Buffer(samples)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + body.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(body.length, 40)
  await writeFile(path, Buffer.concat([header, body]))
}

const powershell = (script: string): ChildProcess =>
  spawn('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true })

/** 鳴らし終わるまで待つ。 */
const playTone = (path: string): Promise<void> =>
  new Promise((resolve) => {
    powershell(`(New-Object Media.SoundPlayer '${path}').PlaySync()`).on('exit', () => resolve())
  })

/**
 * Windows は syscapture.exe（`npm run build:syscapture` で resources/bin に作る）を通す。
 * 音声デバイスの無い GitHub の Windows ランナーでは取り込めないので、ここでだけ確かめる。
 */
describe.skipIf(notWindows)('システム音声の取得（実機・Windows）', () => {
  const binary = join(process.cwd(), 'resources', 'bin', 'syscapture.exe')

  const capture = async (excludePid: number, during: () => Promise<void>): Promise<Buffer> => {
    const source = new SysCaptureSource(binary, excludePid)
    const chunks: Buffer[] = []
    source.onData((pcm) => chunks.push(pcm))
    await source.start({ sampleRate: SAMPLE_RATE })
    await during()
    await wait(300)
    await source.stop()
    return Buffer.concat(chunks)
  }

  it('他のプロセスが鳴らした音が届き、尺が経過時間と合う', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'omr-syscheck-'))
    const tone = join(dir, 'tone.wav')
    await writeTone(tone)
    // 除外の対象には、音を鳴らさない別のプロセスを渡す。
    const bystander = powershell('Start-Sleep -Seconds 30')
    try {
      const started = Date.now()
      const pcm = await capture(bystander.pid ?? 0, () => playTone(tone))
      const elapsedMs = Date.now() - started

      console.log({ seconds: pcm.length / 2 / SAMPLE_RATE, elapsedMs, tone: toneAmplitude(pcm, SAMPLE_RATE) })
      expect(toneAmplitude(pcm, SAMPLE_RATE)).toBeGreaterThan(0.2)
      expect(pcm.length / 2 / SAMPLE_RATE).toBeGreaterThan((elapsedMs / 1000) * 0.8)
    } finally {
      bystander.kill()
    }
  }, 30_000)

  it('除外したプロセスの木（このアプリ自身にあたる）が鳴らした音は入らない', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'omr-syscheck-'))
    const tone = join(dir, 'tone.wav')
    await writeTone(tone)

    // 鳴らす powershell はこのプロセスの子なので、process.pid を除けば木ごと除かれる。
    const pcm = await capture(process.pid, () => playTone(tone))

    console.log({ tone: toneAmplitude(pcm, SAMPLE_RATE) })
    expect(toneAmplitude(pcm, SAMPLE_RATE)).toBeLessThan(0.02)
  }, 30_000)
})
