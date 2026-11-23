import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { LiveTranscriptionEvent, LiveTranscriptionPort } from '@application/ports'
import type { CaptionTrack, LiveCaptionStatus } from '@domain/LiveCaption'
import { failureOfExit, frameOf, parseLiveTranscribeLine, parseLiveTranscribeStatus } from './liveTranscribeProtocol'

/** status は OS に可否を聞くだけ。固まっても設定画面を待たせない。 */
const STATUS_TIMEOUT_MS = 10_000

/**
 * 止めるときに確定を待つ時間。macOS 27 では finalizeAndFinishThroughEndOfInput が返らないことがあり、
 * livetranscribe も 1.5 秒で自分から終わる。停止の後にはパイプラインが控えているので、それより長く待たない。
 */
const STOP_TIMEOUT_MS = 2_000

/**
 * 認識器が詰まったときに stdin へ溜めてよい量（既定の 16kHz の 2 トラックで約 15 秒分、48kHz なら約 5 秒分）。
 * 溢れた PCM は字幕に要らないので捨てる。
 * 溜め続けると、詰まった認識器のせいで main のメモリが録音の長さだけ膨らむ。
 */
const MAX_PENDING_BYTES = 1_000_000

/**
 * SpeechAnalyzer で録音中のライブ字幕を作る（ADR-050）。同梱の livetranscribe を録音の間だけ動かし、
 * 2 トラックの PCM を 1 本の stdin に枠付きで流す。行の分け方は MicUsageProbe、止め方は SysCaptureSource に倣う。
 */
export class AppleLiveTranscriber implements LiveTranscriptionPort {
  private child: ChildProcessWithoutNullStreams | undefined
  private readonly stopped = new WeakSet<ChildProcessWithoutNullStreams>()
  private readonly stopTimeoutMs: number

  constructor(
    private readonly binaryPath: string | undefined,
    options: { stopTimeoutMs?: number } = {}
  ) {
    this.stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS
  }

  async start(params: {
    sampleRate: number
    locale: string
    onEvent: (event: LiveTranscriptionEvent) => void
  }): Promise<void> {
    if (this.child) return
    if (this.binaryPath === undefined) {
      params.onEvent({ type: 'failed', reason: 'missing' })
      return
    }

    const child = spawn(this.binaryPath, [
      'stream',
      '--locale',
      params.locale,
      '--sample-rate',
      String(params.sampleRate)
    ])
    this.child = child

    let pending = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      const lines = (pending + chunk).split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const event = parseLiveTranscribeLine(line)
        if (event) params.onEvent(event)
      }
    })
    // 認識の失敗の詳細は stderr に出るが、会議の本文を含みうるので記録しない。
    child.stderr.resume()
    // 止めた後や落ちた後の書き込みで EPIPE が投げられても、録音を巻き込まない。
    child.stdin.on('error', () => {})
    child.on('error', () => {
      if (this.child === child) this.child = undefined
      if (!this.stopped.has(child)) params.onEvent({ type: 'failed', reason: 'crashed' })
    })
    child.on('exit', (code) => {
      if (this.child === child) this.child = undefined
      if (!this.stopped.has(child)) params.onEvent({ type: 'failed', reason: failureOfExit(code) })
    })
  }

  push(track: CaptionTrack, pcm: Uint8Array): void {
    const child = this.child
    if (!child || pcm.length === 0 || child.stdin.writableLength > MAX_PENDING_BYTES) return
    child.stdin.write(frameOf(track, pcm))
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = undefined
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
    this.stopped.add(child)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
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

/** 録音中のアシストが使えるかを livetranscribe に聞く。失敗はすべて「使えない」に倒す。 */
export const liveTranscribeStatus = (binaryPath: string | undefined, locale: string): Promise<LiveCaptionStatus> => {
  if (binaryPath === undefined) return Promise.resolve({ availability: 'missing' })
  return new Promise((resolve) => {
    const child = spawn(binaryPath, ['status', '--locale', locale], { timeout: STATUS_TIMEOUT_MS })
    let stdout = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.resume()
    child.on('error', () => resolve({ availability: 'unavailable' }))
    child.on('close', (code) =>
      resolve(code === 0 ? parseLiveTranscribeStatus(stdout) : { availability: 'unavailable' })
    )
    child.stdin.end()
  })
}
