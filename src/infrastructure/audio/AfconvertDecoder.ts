import { execFile } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { promisify } from 'node:util'
import type { AudioDecoderPort } from '@application/ports'
import { AppError } from '@domain/errors'
import { wavDurationMs } from './wav'

const execFileAsync = promisify(execFile)

export class DecodeError extends AppError {}

const AFCONVERT = '/usr/bin/afconvert'
const AFINFO = '/usr/bin/afinfo'

/**
 * macOS 標準の afconvert で、取り込んだ音声を文字起こしが読める WAV へ変換する。
 *
 * AfconvertEncoder（WAV → m4a）の逆向き。ffmpeg を同梱しない方針を入力側にも広げている
 * ため、読める形式の範囲は afconvert 任せで、そのまま取り込みの上限になる（ADR-030）。
 *
 * `--mix` を付けるのが要点。`-c 1` だけだとチャンネルを順序を考えずに増減するため、
 * 片側のマイクに寄って録れた会議では話者が丸ごと消える。`--mix` は適切にダウンミックスする。
 * ただし `--mix` はモノラル入力にだけ付けない。入力が出力と同じ形式（16kHz モノラル 16bit）
 * だと afconvert が「Couldn't set audio converter property (-50)」で失敗するため。
 * モノラルなら混ぜるチャンネルが無いので、外しても話者が消えることはない。
 * サンプルレート変換の品質（`--src-quality`）は既定の 127 で足りる。
 *
 * 16bit（`LEI16`）を指定するのは、後段の readWav と話者識別が 16bit PCM を前提とするため。
 */
export class AfconvertDecoder implements AudioDecoderPort {
  async decode(params: {
    inputPath: string
    outputPath: string
    sampleRate: number
  }): Promise<{ durationMs: number }> {
    await mkdir(dirname(params.outputPath), { recursive: true })

    try {
      await this.convert(params)
    } catch (error: unknown) {
      // 途中まで書かれた WAV を残すと、中身の無い録音が次の取り込みで作られる。
      // 出力を書いたのはここなので、後始末もここで行う。
      await rm(params.outputPath, { force: true })

      throw new DecodeError(
        `「${basename(params.inputPath)}」の音声を読み取れませんでした。` +
          'ファイルが壊れているか、対応していない符号化方式かもしれません。',
        { cause: error }
      )
    }

    return { durationMs: await wavDurationMs(params.outputPath) }
  }

  private async convert(params: { inputPath: string; outputPath: string; sampleRate: number }): Promise<void> {
    const mix = (await this.channelCount(params.inputPath)) !== 1
    const args = [
      '-f',
      'WAVE', // 出力コンテナ
      '-d',
      `LEI16@${params.sampleRate}`, // 16bit リトルエンディアン PCM
      '-c',
      '1',
      ...(mix ? ['--mix'] : []), // ステレオ以上を捨てずに混ぜる
      params.inputPath,
      params.outputPath
    ]
    await execFileAsync(AFCONVERT, args)
  }

  /**
   * 入力のチャンネル数。afinfo の出力から数を読み取れないときは null を返し、呼び手は `--mix` を付ける側に
   * 倒す。モノラルを取り違えても失敗するだけだが、多チャンネルを取り違えると話者が黙って消えるため。
   */
  private async channelCount(inputPath: string): Promise<number | null> {
    const { stdout } = await execFileAsync(AFINFO, [inputPath])
    // 複数トラックを持つファイルもあるので、最も多いものを採る（1 本でも多チャンネルなら混ぜる）。
    const counts = [...stdout.matchAll(/Data format:\s+(\d+) ch/g)].map((m) => Number(m[1]))
    return counts.length === 0 ? null : Math.max(...counts)
  }
}
