import { describe, expect, it } from 'vitest'
import { AppError, ConfigurationError } from '@domain/errors'
import { errorFromWorker, errorToWorkerPayload } from '../../src/main/worker/workerError'

/**
 * ワーカーは UI の言語を知らない。理由をそのまま main へ運び、文言は main が引く（ADR-043）。
 */
describe('ワーカーのエラーの受け渡し', () => {
  it('理由のあるエラーは理由ごと運び、main 側で同じ理由のエラーに戻す', () => {
    const payload = errorToWorkerPayload(new ConfigurationError({ code: 'searchModelMissing' }))

    expect(payload).toEqual({ message: 'searchModelMissing', reason: { code: 'searchModelMissing' } })

    const restored = errorFromWorker(payload)
    expect(restored).toBeInstanceOf(AppError)
    expect(restored).toMatchObject({ reason: { code: 'searchModelMissing' } })
  })

  it('理由の無いエラーはメッセージだけを運ぶ', () => {
    const payload = errorToWorkerPayload(new Error('native crash'))

    expect(payload).toEqual({ message: 'native crash' })
    expect(errorFromWorker(payload)).not.toBeInstanceOf(AppError)
    expect(errorFromWorker(payload).message).toBe('native crash')
  })
})
