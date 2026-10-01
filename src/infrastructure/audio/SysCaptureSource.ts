import { type ChildProcessWithoutNullStreams, spawn as nodeSpawn } from 'node:child_process'
import { AppError } from '@domain/errors'
import { SystemAudioBinaryError } from './AudioTeeSource'
import type { SystemAudioSource } from './DualTrackRecorder'

/** 補助プログラムは起動したが、システム音声を取り込めなかった。 */
export class SystemAudioCaptureError extends AppError {}

export interface SysCaptureOptions {
  readonly spawn?: (command: string, args: readonly string[]) => ChildProcessWithoutNullStreams
  /** 最初の PCM を待つ時間。syscapture は無音でも 100ms ごとに書き出すので、来なければ動いていない。 */
  readonly startTimeoutMs?: number
  /** stdin を閉じてから終わりを待つ時間。過ぎたら kill する。 */
  readonly stopTimeoutMs?: number
}

/** 理由として見せる stderr の長さの上限。補助プログラムは 1 行しか書かないので、それ以上は要らない。 */
const MAX_DETAIL = 500

/**
 * Windows でシステム音声（相手の声）を取り込む。補助プログラム syscapture.exe（native/syscapture）を
 * 子プロセスとして起動し、stdout の 16bit モノラル PCM を受け取る（ADR-048）。
 *
 * WASAPI のプロセス loopback で、Exolobe 自身（main と、その子の renderer）の音を除いて録る。
 * 除くのは main の PID 以下の木なので、再生のプレビューなどが相手の声のトラックに入らない。
 * テスト録音は逆に自分の確認音が入るかで判定するので、除かずに録る。
 *
 * 止めるときは stdin を閉じる。main が落ちたときもパイプが閉じて補助プログラムが終わるので、
 * 録音を続ける孤児プロセスが残らない。
 */
export class SysCaptureSource implements SystemAudioSource {
  private child: ChildProcessWithoutNullStreams | undefined
  /** stop() で止めたもの。終了をエラーとして知らせない。 */
  private readonly stopped = new WeakSet<ChildProcessWithoutNullStreams>()
  private dataListener: (pcm: Buffer) => void = () => {}
  private errorListener: (error: Error) => void = () => {}
  private readonly spawn: NonNullable<SysCaptureOptions['spawn']>
  private readonly startTimeoutMs: number
  private readonly stopTimeoutMs: number

  constructor(
    private readonly binaryPath: string | undefined,
    /** 録らないプロセスの木の根。undefined ならこのアプリの音も録る（テスト録音の確認音を拾うため）。 */
    private readonly excludePid: number | undefined,
    options: SysCaptureOptions = {}
  ) {
    this.spawn = options.spawn ?? ((command, args) => nodeSpawn(command, args, { windowsHide: true }))
    this.startTimeoutMs = options.startTimeoutMs ?? 5_000
    this.stopTimeoutMs = options.stopTimeoutMs ?? 3_000
  }

  onData(listener: (pcm: Buffer) => void): void {
    this.dataListener = listener
  }

  onError(listener: (error: Error) => void): void {
    this.errorListener = listener
  }

  async start(params: { sampleRate: number }): Promise<void> {
    if (this.binaryPath === undefined) {
      throw new SystemAudioBinaryError({ code: 'systemAudioBinary', detail: 'syscapture.exe' })
    }
    const child = this.spawn(this.binaryPath, [
      '--sample-rate',
      String(params.sampleRate),
      ...(this.excludePid === undefined ? [] : ['--exclude-pid', String(this.excludePid)])
    ])
    this.child = child

    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (text: string) => {
      stderr = (stderr + text).slice(-MAX_DETAIL)
    })
    // 補助プログラムが先に終わっていると、閉じるときに EPIPE になる。終わりは exit で扱う。
    child.stdin.on('error', () => {})

    await new Promise<void>((resolve, reject) => {
      let started = false
      // パイプの区切りはサンプルの境目と関係ない。半端な 1 バイトは次のチャンクにつなぐ。
      let pending: Buffer = Buffer.alloc(0)
      const fail = (error: Error): void => {
        clearTimeout(timer)
        if (started) this.errorListener(error)
        else reject(error)
      }
      const timer = setTimeout(() => {
        if (started) return
        child.kill()
        fail(new SystemAudioCaptureError({ code: 'systemAudioCapture', detail: 'no audio data' }))
      }, this.startTimeoutMs)

      child.stdout.on('data', (chunk: Buffer) => {
        const data = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
        const aligned = data.length - (data.length % 2)
        pending = data.subarray(aligned)
        if (!started) {
          started = true
          clearTimeout(timer)
          resolve()
        }
        if (aligned > 0) this.dataListener(data.subarray(0, aligned))
      })
      child.on('error', (error) => {
        fail(new SystemAudioBinaryError({ code: 'systemAudioBinary', detail: error.message }, { cause: error }))
      })
      child.on('exit', (code) => {
        if (this.child === child) this.child = undefined
        if (this.stopped.has(child)) return
        const detail = stderr.trim() || `exit code ${String(code)}`
        fail(new SystemAudioCaptureError({ code: 'systemAudioCapture', detail }))
      })
    })
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = undefined
    if (child === undefined || child.exitCode !== null) return
    this.stopped.add(child)

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill()
        resolve()
      }, this.stopTimeoutMs)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.stdin.end()
    })
  }
}
