import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '@domain/errors'
import {
  AppleLmSessionFactory,
  appleIntelligenceStatus
} from '@infrastructure/summarization/AppleLmSessionFactory'
import { parseAppleLmStatus } from '@infrastructure/summarization/appleLmProtocol'
import { resolveAppleLmBinary } from '@infrastructure/summarization/resolveAppleLmBinary'

describe('parseAppleLmStatus', () => {
  it('使えるときはコンテキスト長も読む', () => {
    expect(parseAppleLmStatus('{"availability":"available","contextSize":8192}\n')).toEqual({
      availability: 'available',
      contextSize: 8192
    })
  })

  it('使えない理由を読む', () => {
    expect(parseAppleLmStatus('{"availability":"apple-intelligence-not-enabled"}')).toEqual({
      availability: 'apple-intelligence-not-enabled'
    })
    expect(parseAppleLmStatus('{"availability":"unsupported-os"}')).toEqual({
      availability: 'unsupported-os'
    })
  })

  it('知らない理由や壊れた出力は「使えない」として読む', () => {
    expect(parseAppleLmStatus('{"availability":"something-new"}')).toEqual({
      availability: 'unavailable'
    })
    expect(parseAppleLmStatus('not json')).toEqual({ availability: 'unavailable' })
  })

  it('使えると言いながらコンテキスト長が無ければ、使えないとして読む', () => {
    // コンテキスト長が分からないと分割の大きさを決められない。
    expect(parseAppleLmStatus('{"availability":"available"}')).toEqual({
      availability: 'unavailable'
    })
  })
})

describe('resolveAppleLmBinary', () => {
  it('開発時はリポジトリの resources/bin を、配布時は Resources/bin を見る', () => {
    const exists = () => true

    expect(resolveAppleLmBinary({ packaged: false, resourcesPath: '', cwd: '/repo', exists })).toBe(
      '/repo/resources/bin/applelm'
    )
    expect(
      resolveAppleLmBinary({ packaged: true, resourcesPath: '/App/Resources', exists })
    ).toBe('/App/Resources/bin/applelm')
  })

  it('無ければ undefined', () => {
    expect(
      resolveAppleLmBinary({ packaged: true, resourcesPath: '/App', exists: () => false })
    ).toBeUndefined()
  })
})

describe('applelm を呼ぶ', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'applelm-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  /** 本物の代わりに置く applelm。受け取った引数と標準入力を記録する。 */
  const helper = async (body: string): Promise<string> => {
    const path = join(dir, 'applelm')
    await writeFile(
      path,
      `#!/bin/sh\necho "$@" > "${dir}/args"\ncat > "${dir}/stdin"\n${body}\n`
    )
    await chmod(path, 0o755)
    return path
  }

  const reasonOf = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(AppError)
    return (error as AppError).reason
  }

  describe('appleIntelligenceStatus', () => {
    it('status を聞いて読む', async () => {
      const path = await helper(`echo '{"availability":"available","contextSize":8192}'`)

      expect(await appleIntelligenceStatus(path)).toEqual({
        availability: 'available',
        contextSize: 8192
      })
      expect((await readFile(join(dir, 'args'), 'utf8')).trim()).toBe('status')
    })

    it('同梱物が無ければ missing', async () => {
      expect(await appleIntelligenceStatus(undefined)).toEqual({ availability: 'missing' })
    })

    it('起動に失敗したら使えないとして返す', async () => {
      const path = await helper('exit 1')

      expect(await appleIntelligenceStatus(path)).toEqual({ availability: 'unavailable' })
    })
  })

  describe('AppleLmSessionFactory', () => {
    it('プロンプトを標準入力で渡し、応答の本文を返す', async () => {
      const path = await helper(`echo '## 概要'`)
      const session = await new AppleLmSessionFactory(path).create()

      expect(await session.prompt('議事録を作って')).toBe('## 概要\n')
      expect((await readFile(join(dir, 'args'), 'utf8')).trim()).toBe('respond')
      expect(await readFile(join(dir, 'stdin'), 'utf8')).toBe('議事録を作って')
    })

    it('同梱物が無ければ、使えない理由を missing として投げる', async () => {
      expect(await reasonOf(new AppleLmSessionFactory(undefined).create())).toEqual({
        code: 'appleIntelligenceUnavailable',
        availability: 'missing'
      })
    })

    it('使えなければ、applelm が返した理由で投げる', async () => {
      const path = await helper('echo model-not-ready >&2; exit 2')
      const session = await new AppleLmSessionFactory(path).create()

      expect(await reasonOf(session.prompt('x'))).toEqual({
        code: 'appleIntelligenceUnavailable',
        availability: 'model-not-ready'
      })
    })

    it('安全フィルタに拒まれたら、そう伝える', async () => {
      const path = await helper('echo guardrailViolation >&2; exit 3')
      const session = await new AppleLmSessionFactory(path).create()

      expect(await reasonOf(session.prompt('x'))).toEqual({ code: 'appleIntelligenceRejected' })
    })

    it('言語が非対応なら、そう伝える', async () => {
      const path = await helper('exit 5')
      const session = await new AppleLmSessionFactory(path).create()

      expect(await reasonOf(session.prompt('x'))).toEqual({
        code: 'appleIntelligenceUnsupportedLanguage'
      })
    })

    it('それ以外の失敗は詳細を添えて投げる', async () => {
      const path = await helper('echo "exceededContextWindowSize" >&2; exit 4')
      const session = await new AppleLmSessionFactory(path).create()

      expect(await reasonOf(session.prompt('x'))).toEqual({
        code: 'appleIntelligenceFailed',
        detail: 'exceededContextWindowSize'
      })
    })
  })
})
