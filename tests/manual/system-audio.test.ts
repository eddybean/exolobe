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
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AudioTeeSource } from '@infrastructure/audio/AudioTeeSource'
import { DualTrackRecorder, peakOf } from '@infrastructure/audio/DualTrackRecorder'

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
  const child = spawn('/bin/sh', [
    '-c',
    'for i in 1 2 3 4 5 6; do afplay /System/Library/Sounds/Ping.aiff; done'
  ])
  return () => child.kill()
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('システム音声の取得（実機）', () => {
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
