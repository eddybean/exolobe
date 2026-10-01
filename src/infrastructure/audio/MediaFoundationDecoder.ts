import { mkdir, rm } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { AudioDecoderPort } from '@application/ports'
import { DecodeError } from './AfconvertDecoder'
import { type RunAudioConv, runAudioConv } from './MediaFoundationEncoder'
import { wavDurationMs } from './wav'

/**
 * Windows の Media Foundation で、取り込んだ音声（と保存済みの audio.m4a）を 16bit モノラルの WAV にする。
 * macOS の AfconvertDecoder に当たる。変換は補助プログラム audioconv.exe（native/audioconv）が行う（ADR-048）。
 *
 * 複数チャンネルは混ぜて 1ch にする（audioconv が Media Foundation に混ぜさせる）。片チャンネルを捨てると、
 * そちらにしか入っていない話者が丸ごと消える（ADR-030）。読める形式の範囲は Media Foundation 任せで、
 * 取り込める拡張子の一覧（MEDIA_FOUNDATION_IMPORT_FORMATS）はそれを実機で確かめて起こした。
 */
export class MediaFoundationDecoder implements AudioDecoderPort {
  constructor(
    private readonly binaryPath: string | undefined,
    private readonly run: RunAudioConv = runAudioConv
  ) {}

  async decode(params: { inputPath: string; outputPath: string; sampleRate: number }): Promise<{ durationMs: number }> {
    const fileName = basename(params.inputPath)
    if (this.binaryPath === undefined) {
      throw new DecodeError({ code: 'decodeFailed', fileName }, { cause: new Error('audioconv.exe not found') })
    }
    await mkdir(dirname(params.outputPath), { recursive: true })

    try {
      await this.run(this.binaryPath, [
        'decode',
        '--input',
        params.inputPath,
        '--output',
        params.outputPath,
        '--sample-rate',
        String(params.sampleRate)
      ])
    } catch (error: unknown) {
      // audioconv は一時ファイルに書いてから置き換えるので半端な出力は残さないが、
      // 中身の無い録音が次の取り込みで作られないよう、ここでも後始末する（AfconvertDecoder と同じ約束）。
      await rm(params.outputPath, { force: true })
      throw new DecodeError({ code: 'decodeFailed', fileName }, { cause: error })
    }

    return { durationMs: await wavDurationMs(params.outputPath) }
  }
}
