import type { AudioTee } from 'audiotee'
import { AppError } from '@domain/errors'
import type { SystemAudioSource } from './DualTrackRecorder'

export class SystemAudioPermissionError extends AppError {}

/**
 * Core Audio Process Tap (macOS 14.2+) でデスクトップ音声を取得する。
 *
 * 仮想オーディオデバイス（BlackHole 等）も画面収録も不要で、権限は
 * 「オーディオ録音のみ」で済む。ScreenCaptureKit と違い映像を伴わず、
 * ミキサー前の信号を取るためシステム音量の影響も受けない。
 *
 * audiotee は Swift 製バイナリを子プロセスとして起動する薄いラッパーで、
 * Electron に同梱すると親アプリの署名を継承する（TCC の権限付与に必要）。
 */
export class AudioTeeSource implements SystemAudioSource {
  private tee: AudioTee | undefined
  private dataListener: (pcm: Buffer) => void = () => {}
  private errorListener: (error: Error) => void = () => {}

  constructor(private readonly binaryPath?: string) {}

  onData(listener: (pcm: Buffer) => void): void {
    this.dataListener = listener
  }

  onError(listener: (error: Error) => void): void {
    this.errorListener = listener
  }

  async start(params: { sampleRate: number }): Promise<void> {
    // audiotee は ESM 専用パッケージなので、CJS の main プロセスからは
    // 動的 import で読み込む（静的 import は require に変換されて失敗する）。
    const { AudioTee } = await import('audiotee')

    // sampleRate を指定すると audiotee は 16bit モノラルへ変換して流す。
    const tee = new AudioTee({
      sampleRate: params.sampleRate,
      ...(this.binaryPath === undefined ? {} : { binaryPath: this.binaryPath })
    })

    tee.on('data', (chunk) => {
      this.dataListener(chunk.data)
    })
    tee.on('error', (error) => {
      this.errorListener(this.describe(error))
    })

    this.tee = tee

    try {
      await tee.start()
    } catch (error: unknown) {
      this.tee = undefined
      throw this.describe(error)
    }
  }

  async stop(): Promise<void> {
    const tee = this.tee
    this.tee = undefined
    if (tee?.isActive()) await tee.stop()
  }

  /**
   * TCC による拒否は子プロセスの起動失敗として現れ、原因が伝わりにくい。
   * 利用者が次に取るべき操作へつながるメッセージに変換する。
   */
  private describe(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error)

    if (/permission|denied|not authorized|tap/i.test(message)) {
      return new SystemAudioPermissionError(
        'システム音声を取得できませんでした。「システム設定 > プライバシーとセキュリティ > ' +
          'オーディオ録音」でこのアプリを許可してください。',
        { cause: error }
      )
    }

    return error instanceof Error ? error : new Error(message)
  }
}
