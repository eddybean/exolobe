import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { parseMicUsageLine } from './micUsageProtocol'

/**
 * 同梱の micwatch を動かし、他のアプリのマイク使用状態を流す。
 *
 * CoreAudio のデバイス状態は Electron からは読めないため、小さな Swift の
 * ヘルパーに任せる。音声データには触れず、状態が変わったときだけ 1 行届く。
 *
 * 見張るのは録音していない間だけなので、start/stop で子プロセスごと開始・終了する。
 * バイナリが無い場合（開発中にまだビルドしていない等）や起動に失敗した場合は、
 * notifySilence と同じ方針で黙って何もしない。開始忘れの見張りが無効になるだけで
 * 録音そのものは動く。
 */
export class MicUsageProbe {
  private child: ChildProcessByStdio<null, Readable, null> | undefined
  private listeners: ((inUse: boolean) => void)[] = []
  /** 行の途中で chunk が切れることがあるため、次の chunk まで持ち越す。 */
  private pending = ''

  constructor(private readonly binaryPath: string | undefined) {}

  /** 同梱バイナリが見つかっており、見張りを動かせるか。 */
  get available(): boolean {
    return this.binaryPath !== undefined
  }

  onChange(listener: (inUse: boolean) => void): void {
    this.listeners.push(listener)
  }

  start(): void {
    if (this.child || !this.binaryPath) return

    let child: ChildProcessByStdio<null, Readable, null>
    try {
      child = spawn(this.binaryPath, [], { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.consume(chunk))
    // 落ちたら「使われていない」に倒す。使用中のまま固定されると、
    // 実際には会議が終わっているのに録音を促し続けてしまう。
    child.on('error', () => this.reset())
    child.on('exit', () => this.reset())

    this.child = child
  }

  stop(): void {
    const child = this.child
    this.child = undefined
    this.pending = ''
    child?.kill()
  }

  private consume(chunk: string): void {
    const lines = (this.pending + chunk).split('\n')
    this.pending = lines.pop() ?? ''

    for (const line of lines) {
      const inUse = parseMicUsageLine(line)
      if (inUse !== undefined) this.notify(inUse)
    }
  }

  private reset(): void {
    this.child = undefined
    this.pending = ''
    this.notify(false)
  }

  private notify(inUse: boolean): void {
    for (const listener of this.listeners) listener(inUse)
  }
}
