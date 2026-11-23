import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WavFileWriter, int16Buffer } from '@infrastructure/audio/wav'
import { SherpaHaasSessionFactory } from '@infrastructure/transcription/SherpaHaasSessionFactory'
import { SherpaHaasTranscriber, type HaasModelPaths } from '@infrastructure/transcription/SherpaHaasTranscriber'
import { notMacOS } from '../platform'

/**
 * 実際の Haas-ja-v1.0（sherpa-onnx 形式）と sherpa-onnx-node で通す。
 *
 * 変換版は TDT であることを encoder のメタデータで sherpa-onnx に伝え、予測ネットワークの状態を
 * LSTM の形のテンソルに詰めて渡している（ADR-049）。どちらも sherpa-onnx の内部の挙動に頼るので、
 * sherpa-onnx-node を上げたら、モデルを置いてこのテストを走らせて確かめる。
 * モデルは約 480MB あるので CI では走らない。`OMR_HAAS_MODEL_DIR` に 6 ファイルを置いたディレクトリを渡す。
 */
const modelDir = process.env['OMR_HAAS_MODEL_DIR'] ?? ''
const model: HaasModelPaths = {
  encoderPath: join(modelDir, 'encoder.quantized.onnx'),
  decoderPath: join(modelDir, 'decoder.onnx'),
  joinerPath: join(modelDir, 'joiner.onnx'),
  tokensPath: join(modelDir, 'tokens.txt'),
  vadModelPath: join(modelDir, 'silero_vad.onnx')
}
const missing = modelDir === '' || !Object.values(model).every((path) => existsSync(path))

describe.skipIf(notMacOS || missing)('SherpaHaasSessionFactory（実モデル）', () => {
  let dir: string
  const transcriber = new SherpaHaasTranscriber(model, new SherpaHaasSessionFactory())

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'haas-real-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  /** 前後に無音を挟んだ合成音声。VAD が区間を切り出し、時刻を録音へ戻せるかを見る。 */
  const speech = (sampleRate: number): string => {
    const aiff = join(dir, 'speech.aiff')
    const wav = join(dir, `speech-${sampleRate}.wav`)
    execFileSync('say', [
      '-v',
      'Kyoko',
      '-o',
      aiff,
      '[[slnc 3000]] 本日の会議では、来月のリリース計画について確認します。進捗も報告します。'
    ])
    execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${sampleRate}`, '-c', '1', aiff, wav])
    return wav
  }

  it('日本語の発話を句読点つきで起こし、無音の後の時刻に置く', async () => {
    const segments = await transcriber.transcribe({ wavPath: speech(16_000), language: 'ja', speakerId: 'remote' })

    expect(segments.map((segment) => segment.text).join('')).toContain('リリース計画')
    // 「捗」は語彙に無くバイトのトークンで届く。文に分けて組み立てても字に戻っていること。
    expect(segments.map((segment) => segment.text).join('')).toContain('進捗')
    expect(segments[0]?.startMs).toBeGreaterThan(2_500)
  }, 60_000)

  it('16kHz 以外の録音も起こせる', async () => {
    const segments = await transcriber.transcribe({ wavPath: speech(48_000), language: 'ja', speakerId: 'remote' })

    expect(segments.map((segment) => segment.text).join('')).toContain('リリース計画')
  }, 60_000)

  it('無音だけの録音からは何も起こさない', async () => {
    const wav = join(dir, 'silence.wav')
    const writer = await WavFileWriter.create(wav, { sampleRate: 16_000, channels: 1 })
    await writer.write(int16Buffer(Array.from({ length: 16_000 * 20 }, () => Math.round((Math.random() - 0.5) * 60))))
    await writer.close()

    expect(await transcriber.transcribe({ wavPath: wav, language: 'ja', speakerId: 'remote' })).toEqual([])
  }, 60_000)
})
