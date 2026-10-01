import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import type { AudioEncoderPort } from '@application/ports'
import { toMessage } from '@domain/errors'
import type { AudioCodec } from '@domain/Settings'
import { EncodeError } from './AfconvertEncoder'

/** audioconv.exe を 1 回呼ぶ。テストでは差し替える。 */
export type RunAudioConv = (file: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>

const execFileAsync = promisify(execFile)

export const runAudioConv: RunAudioConv = (file, args) => execFileAsync(file, [...args], { windowsHide: true })

/** 利用者に見せる失敗の中身。audioconv は理由を stderr に 1 行書くので、それを優先する。 */
export const audioConvDetail = (error: unknown): string => {
  const stderr = (error as { stderr?: unknown } | undefined)?.stderr
  if (typeof stderr === 'string' && stderr.trim() !== '') return stderr.trim()
  return toMessage(error)
}

/**
 * Windows の Media Foundation で、録音の WAV を配布用の m4a（AAC-LC）にする。macOS の AfconvertEncoder に当たる。
 * 変換は補助プログラム audioconv.exe（native/audioconv）が行う（ADR-048）。
 *
 * Windows の AAC エンコーダはサンプルレートごとに使えるビットレートが決まっている
 * （16kHz なら 12〜32kbps、44.1kHz なら 48kbps 以上）。audioconv が指定に一番近いものを選ぶので、
 * 設定のビットレートがそのまま使われるとは限らない。既定の 16kHz・32kbps はそのまま使える。
 *
 * HE-AAC（aach）は Windows では選ばせない。macOS から持ち込んだ設定で aach が来ても、保存を止めずに
 * AAC-LC で保存する。音声を残すことの方が、符号化方式の指定を守ることより大事なため。
 */
export class MediaFoundationEncoder implements AudioEncoderPort {
  constructor(
    private readonly binaryPath: string | undefined,
    private readonly run: RunAudioConv = runAudioConv
  ) {}

  async encode(params: {
    inputPath: string
    outputPath: string
    codec: AudioCodec
    bitrateKbps: number
  }): Promise<void> {
    if (this.binaryPath === undefined) {
      throw new EncodeError({ code: 'encodeFailed', detail: 'audioconv.exe not found' })
    }
    await mkdir(dirname(params.outputPath), { recursive: true })

    const args = [
      'encode',
      '--input',
      params.inputPath,
      '--output',
      params.outputPath,
      '--bitrate',
      String(params.bitrateKbps * 1000)
    ]
    try {
      await this.run(this.binaryPath, args)
    } catch (error: unknown) {
      throw new EncodeError({ code: 'encodeFailed', detail: audioConvDetail(error) }, { cause: error })
    }
  }
}
