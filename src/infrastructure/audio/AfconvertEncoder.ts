import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import type { AudioEncoderPort } from '@application/ports'
import { AppError, toMessage } from '@domain/errors'
import type { AudioCodec } from '@domain/Settings'

const execFileAsync = promisify(execFile)

export class EncodeError extends AppError {}

const AFCONVERT = '/usr/bin/afconvert'

/**
 * macOS 標準の afconvert で WAV を AAC (.m4a) へ変換する。
 *
 * ffmpeg を同梱せずに済むため配布物が小さく、ライセンス上の考慮も要らない。
 *
 * 既定を AAC-LC にしている理由: 16kHz モノラル入力に HE-AAC (`aach`) を指定すると
 * afconvert は `-b` を無視してコアを 8kHz・約 10kbps まで落とす。容量は小さくなるが
 * 会議音声の明瞭さと再文字起こしの余地を損なうため、指定ビットレートを守り 16kHz を
 * 保つ AAC-LC を既定とする（32kbps で 1 時間あたり約 14MB）。
 */
export class AfconvertEncoder implements AudioEncoderPort {
  async encode(params: {
    inputPath: string
    outputPath: string
    codec: AudioCodec
    bitrateKbps: number
  }): Promise<void> {
    await mkdir(dirname(params.outputPath), { recursive: true })

    const args = [
      '-f',
      'm4af', // 出力コンテナ: MPEG-4 Audio
      '-d',
      params.codec,
      '-b',
      String(params.bitrateKbps * 1000),
      '-s',
      '3', // ビットレート戦略: 3 = Constant Bit Rate
      params.inputPath,
      params.outputPath
    ]

    try {
      await execFileAsync(AFCONVERT, args)
    } catch (error: unknown) {
      throw new EncodeError({ code: 'encodeFailed', detail: toMessage(error) }, { cause: error })
    }
  }
}
