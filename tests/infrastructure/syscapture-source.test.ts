import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { AppError } from '@domain/errors'
import { SysCaptureSource } from '@infrastructure/audio/SysCaptureSource'
import { resolveSysCaptureBinary } from '@infrastructure/audio/resolveSysCaptureBinary'

/** syscapture.exe の代わり。stdout に PCM を流し、stdin が閉じたら終わる。 */
class FakeCapture extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  exitCode: number | null = null
  killed = false
  stdinClosed = false

  constructor(private readonly exitOnStdinClose = true) {
    super()
    this.stdin.on('finish', () => {
      this.stdinClosed = true
      if (this.exitOnStdinClose) this.exit(0)
    })
  }

  pcm(bytes: number[]): void {
    this.stdout.write(Buffer.from(bytes))
  }

  exit(code: number, stderr = ''): void {
    if (stderr) this.stderr.write(stderr)
    // stderr の data が先に届くよう、終了の知らせは一拍おく（実際の子プロセスと同じ順）。
    setImmediate(() => {
      this.exitCode = code
      this.emit('exit', code, null)
    })
  }

  kill(): boolean {
    this.killed = true
    this.exit(1)
    return true
  }
}

const setup = (
  options: {
    binary?: string | undefined
    excludePid?: number | undefined
    exitOnStdinClose?: boolean
    startTimeoutMs?: number
    stopTimeoutMs?: number
  } = {}
) => {
  const fake = new FakeCapture(options.exitOnStdinClose)
  const calls: { command: string; args: readonly string[] }[] = []
  const binary = 'binary' in options ? options.binary : 'C:/bin/syscapture.exe'
  const excludePid = 'excludePid' in options ? options.excludePid : 4321
  const source = new SysCaptureSource(binary, excludePid, {
    spawn: (command, args) => {
      calls.push({ command, args })
      return fake as unknown as ChildProcessWithoutNullStreams
    },
    startTimeoutMs: options.startTimeoutMs ?? 1_000,
    stopTimeoutMs: options.stopTimeoutMs ?? 1_000
  })
  const received: Buffer[] = []
  const errors: Error[] = []
  source.onData((pcm) => received.push(pcm))
  source.onError((error) => errors.push(error))
  return { fake, calls, source, received, errors }
}

const reasonOf = (error: unknown): unknown => (error instanceof AppError ? error.reason : error)

describe('SysCaptureSource', () => {
  it('サンプルレートと、録らない自分のプロセスを渡して起動する', async () => {
    const { fake, calls, source } = setup()
    const started = source.start({ sampleRate: 16_000 })
    fake.pcm([0, 0])
    await started

    expect(calls).toEqual([
      { command: 'C:/bin/syscapture.exe', args: ['--sample-rate', '16000', '--exclude-pid', '4321'] }
    ])
  })

  it('除くプロセスを指定しなければ、このアプリの音も含めて録る（テスト録音の確認音を拾うため）', async () => {
    const { fake, calls, source } = setup({ excludePid: undefined })
    const started = source.start({ sampleRate: 16_000 })
    fake.pcm([0, 0])
    await started

    expect(calls[0]?.args).toEqual(['--sample-rate', '16000'])
  })

  it('最初の PCM が届いたら開始とみなし、PCM をそのまま渡す', async () => {
    const { fake, source, received } = setup()
    const started = source.start({ sampleRate: 16_000 })
    fake.pcm([1, 2, 3, 4])
    await started

    expect(Buffer.concat(received)).toEqual(Buffer.from([1, 2, 3, 4]))
  })

  it('サンプルの途中で切れたチャンクは、次のチャンクとつないで 2 バイト単位で渡す', async () => {
    const { fake, source, received } = setup()
    const started = source.start({ sampleRate: 16_000 })
    fake.pcm([1, 2, 3])
    await started
    fake.pcm([4, 5, 6])
    await new Promise((resolve) => setImmediate(resolve))

    expect(received.every((chunk) => chunk.length % 2 === 0)).toBe(true)
    expect(Buffer.concat(received)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]))
  })

  it('同梱バイナリが無ければ、起動せずに理由付きで断る', async () => {
    const { calls, source } = setup({ binary: undefined })

    const error = await source.start({ sampleRate: 16_000 }).catch((e: unknown) => e)

    expect(reasonOf(error)).toMatchObject({ code: 'systemAudioBinary' })
    expect(calls).toEqual([])
  })

  it('起動できなければ（spawn の失敗）、同梱バイナリの問題として断る', async () => {
    const { fake, source } = setup()
    const started = source.start({ sampleRate: 16_000 })
    fake.emit('error', new Error('spawn C:/bin/syscapture.exe ENOENT'))

    expect(reasonOf(await started.catch((e: unknown) => e))).toMatchObject({ code: 'systemAudioBinary' })
  })

  it('PCM を出す前に終わったら、stderr の内容を添えて取り込めなかったと断る', async () => {
    const { fake, source } = setup()
    const started = source.start({ sampleRate: 16_000 })
    fake.exit(3, 'syscapture: activate: 0x80070005\n')

    expect(reasonOf(await started.catch((e: unknown) => e))).toEqual({
      code: 'systemAudioCapture',
      detail: 'syscapture: activate: 0x80070005'
    })
  })

  it('決めた時間内に PCM が来なければ、止めてから断る', async () => {
    const { fake, source } = setup({ startTimeoutMs: 10 })

    const error = await source.start({ sampleRate: 16_000 }).catch((e: unknown) => e)

    expect(reasonOf(error)).toMatchObject({ code: 'systemAudioCapture' })
    expect(fake.killed).toBe(true)
  })

  it('録音の途中で終わったら、エラーとして知らせる', async () => {
    const { fake, source, errors } = setup()
    const started = source.start({ sampleRate: 16_000 })
    fake.pcm([0, 0])
    await started
    fake.exit(5, 'syscapture: GetBuffer: 0x88890004\n')
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(errors.map(reasonOf)).toEqual([{ code: 'systemAudioCapture', detail: 'syscapture: GetBuffer: 0x88890004' }])
  })

  it('止めるときは stdin を閉じて終わりを待ち、エラーにはしない', async () => {
    const { fake, source, errors } = setup()
    const started = source.start({ sampleRate: 16_000 })
    fake.pcm([0, 0])
    await started

    await source.stop()

    expect(fake.stdinClosed).toBe(true)
    expect(fake.killed).toBe(false)
    expect(errors).toEqual([])
  })

  it('stdin を閉じても終わらなければ、待ちきれずに止める', async () => {
    const { fake, source } = setup({ exitOnStdinClose: false, stopTimeoutMs: 10 })
    const started = source.start({ sampleRate: 16_000 })
    fake.pcm([0, 0])
    await started

    await source.stop()

    expect(fake.killed).toBe(true)
  })

  it('始めていなければ、止めても何もしない', async () => {
    const { source } = setup()

    await expect(source.stop()).resolves.toBeUndefined()
  })
})

describe('resolveSysCaptureBinary', () => {
  it('配布版は Resources/bin の syscapture.exe を使う', () => {
    const path = resolveSysCaptureBinary({
      platform: 'win32',
      packaged: true,
      resourcesPath: 'C:/Program Files/Exolobe/resources',
      cwd: 'C:/repo',
      exists: () => true
    })

    expect(path).toBe(join('C:/Program Files/Exolobe/resources', 'bin', 'syscapture.exe'))
  })

  it('まだビルドしていなければ undefined（録音の開始時に理由付きで断る）', () => {
    const path = resolveSysCaptureBinary({
      platform: 'win32',
      packaged: false,
      resourcesPath: '',
      cwd: 'C:/repo',
      exists: () => false
    })

    expect(path).toBeUndefined()
  })
})
