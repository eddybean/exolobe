import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LiveTranscriptionEvent } from '@application/ports'
import { AppleLiveTranscriber, liveTranscribeStatus } from '@infrastructure/live/AppleLiveTranscriber'
import {
  failureOfExit,
  frameOf,
  parseLiveTranscribeLine,
  parseLiveTranscribeStatus
} from '@infrastructure/live/liveTranscribeProtocol'
import { resolveLiveTranscribeBinary } from '@infrastructure/live/resolveLiveTranscribeBinary'
import { notMacOS } from '../platform'

describe('parseLiveTranscribeLine', () => {
  it('字幕の行を読む。track 0 は相手、1 は自分', () => {
    expect(
      parseLiveTranscribeLine(
        '{"type":"caption","track":0,"kind":"volatile","text":"それでは","startMs":0,"endMs":800}'
      )
    ).toEqual({
      type: 'caption',
      caption: { track: 'remote', kind: 'volatile', text: 'それでは', startMs: 0, endMs: 800 }
    })
    expect(
      parseLiveTranscribeLine('{"type":"caption","track":1,"kind":"final","text":"了解","startMs":10,"endMs":20}')
    ).toEqual({ type: 'caption', caption: { track: 'self', kind: 'final', text: '了解', startMs: 10, endMs: 20 } })
  })

  it('準備と取得中の行を読む', () => {
    expect(parseLiveTranscribeLine('{"type":"ready"}')).toEqual({ type: 'ready' })
    expect(parseLiveTranscribeLine('{"type":"downloading"}')).toEqual({ type: 'downloading' })
  })

  it('壊れた行・知らない行は読み飛ばす', () => {
    expect(parseLiveTranscribeLine('not json')).toBeUndefined()
    expect(
      parseLiveTranscribeLine('{"type":"caption","track":2,"kind":"final","text":"x","startMs":0,"endMs":1}')
    ).toBe(undefined)
    expect(parseLiveTranscribeLine('{"type":"something-new"}')).toBeUndefined()
    expect(parseLiveTranscribeLine('')).toBeUndefined()
  })
})

describe('parseLiveTranscribeStatus', () => {
  it('使えるかとモデルの有無を読む', () => {
    expect(parseLiveTranscribeStatus('{"assets":"installed","availability":"available"}\n')).toEqual({
      availability: 'available',
      assets: 'installed'
    })
    expect(parseLiveTranscribeStatus('{"availability":"unsupported-os"}')).toEqual({ availability: 'unsupported-os' })
  })

  it('知らない値や壊れた出力は「使えない」として読む', () => {
    expect(parseLiveTranscribeStatus('{"availability":"new"}')).toEqual({ availability: 'unavailable' })
    expect(parseLiveTranscribeStatus('oops')).toEqual({ availability: 'unavailable' })
  })
})

describe('frameOf', () => {
  it('[track 1B][長さ 4B LE][PCM] の枠にする', () => {
    expect([...frameOf('self', new Uint8Array([1, 2, 3, 4]))]).toEqual([1, 4, 0, 0, 0, 1, 2, 3, 4])
    expect([...frameOf('remote', new Uint8Array([9]))]).toEqual([0, 1, 0, 0, 0, 9])
  })
})

describe('failureOfExit', () => {
  it('終了コードを理由にする', () => {
    expect(failureOfExit(2)).toBe('unsupported-os')
    expect(failureOfExit(3)).toBe('unsupported-locale')
    expect(failureOfExit(1)).toBe('crashed')
    expect(failureOfExit(null)).toBe('crashed')
  })
})

describe('resolveLiveTranscribeBinary', () => {
  it('開発時はリポジトリの resources/bin を、配布時は Resources/bin を見る', () => {
    const exists = () => true
    expect(
      resolveLiveTranscribeBinary({ platform: 'darwin', packaged: false, resourcesPath: '', cwd: '/repo', exists })
    ).toBe(join('/repo', 'resources', 'bin', 'livetranscribe'))
    expect(
      resolveLiveTranscribeBinary({ platform: 'darwin', packaged: true, resourcesPath: '/App/Resources', exists })
    ).toBe(join('/App/Resources', 'bin', 'livetranscribe'))
  })
})

describe('AppleLiveTranscriber（バイナリが無い）', () => {
  it('起動せずに missing を知らせる', async () => {
    const events: LiveTranscriptionEvent[] = []
    await new AppleLiveTranscriber(undefined).start({
      sampleRate: 16_000,
      locale: 'ja-JP',
      onEvent: (event) => events.push(event)
    })

    expect(events).toEqual([{ type: 'failed', reason: 'missing' }])
  })
})

describe.skipIf(notMacOS)('livetranscribe を呼ぶ', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'livetranscribe-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  /** 本物の代わりに置く livetranscribe。引数を記録してから body を実行する。 */
  const helper = async (body: string): Promise<string> => {
    const path = join(dir, 'livetranscribe')
    await writeFile(path, `#!/bin/sh\necho "$@" > "${dir}/args"\n${body}\n`)
    await chmod(path, 0o755)
    return path
  }

  const waitFor = async (condition: () => boolean): Promise<void> => {
    for (let index = 0; index < 200 && !condition(); index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  it('stream を言語とサンプルレートで起こし、出力の行を event にする', async () => {
    const path = await helper(
      [
        `echo '{"type":"ready"}'`,
        `echo '{"type":"caption","track":1,"kind":"final","text":"了解","startMs":0,"endMs":500}'`,
        'cat > /dev/null'
      ].join('\n')
    )
    const events: LiveTranscriptionEvent[] = []
    const transcriber = new AppleLiveTranscriber(path)
    await transcriber.start({ sampleRate: 48_000, locale: 'en-US', onEvent: (event) => events.push(event) })
    await waitFor(() => events.length >= 2)
    await transcriber.stop()

    expect((await readFile(join(dir, 'args'), 'utf8')).trim()).toBe('stream --locale en-US --sample-rate 48000')
    expect(events).toEqual([
      { type: 'ready' },
      { type: 'caption', caption: { track: 'self', kind: 'final', text: '了解', startMs: 0, endMs: 500 } }
    ])
  })

  it('PCM を枠に入れて stdin へ流す', async () => {
    const path = await helper(`cat > "${dir}/stdin"`)
    const transcriber = new AppleLiveTranscriber(path)
    await transcriber.start({ sampleRate: 16_000, locale: 'ja-JP', onEvent: () => {} })
    transcriber.push('remote', new Uint8Array([1, 2]))
    transcriber.push('self', new Uint8Array([3, 4]))
    await transcriber.stop()

    expect([...(await readFile(join(dir, 'stdin')))]).toEqual([0, 2, 0, 0, 0, 1, 2, 1, 2, 0, 0, 0, 3, 4])
  })

  it('stdin を閉じても終わらなければ、待つのを打ち切って止める', async () => {
    const path = await helper('trap "" TERM\nexec sleep 30')
    const transcriber = new AppleLiveTranscriber(path, { stopTimeoutMs: 100 })
    await transcriber.start({ sampleRate: 16_000, locale: 'ja-JP', onEvent: () => {} })

    const startedAt = Date.now()
    await transcriber.stop()

    expect(Date.now() - startedAt).toBeLessThan(2_000)
  })

  it('途中で落ちたら終了コードの理由で知らせる。止めたときは知らせない', async () => {
    const crashing = await helper('exit 3')
    const events: LiveTranscriptionEvent[] = []
    await new AppleLiveTranscriber(crashing).start({
      sampleRate: 16_000,
      locale: 'xx-YY',
      onEvent: (event) => events.push(event)
    })
    await waitFor(() => events.length > 0)
    expect(events).toEqual([{ type: 'failed', reason: 'unsupported-locale' }])

    const quiet = await helper('cat > /dev/null')
    const stopped: LiveTranscriptionEvent[] = []
    const transcriber = new AppleLiveTranscriber(quiet)
    await transcriber.start({ sampleRate: 16_000, locale: 'ja-JP', onEvent: (event) => stopped.push(event) })
    await transcriber.stop()
    expect(stopped).toEqual([])
  })

  it('status を聞いて読む', async () => {
    const path = await helper(`echo '{"availability":"available","assets":"downloadable"}'`)

    expect(await liveTranscribeStatus(path, 'ja-JP')).toEqual({ availability: 'available', assets: 'downloadable' })
    expect((await readFile(join(dir, 'args'), 'utf8')).trim()).toBe('status --locale ja-JP')
    expect(await liveTranscribeStatus(undefined, 'ja-JP')).toEqual({ availability: 'missing' })
  })
})
