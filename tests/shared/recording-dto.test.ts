import { describe, expect, it } from 'vitest'
import { createRecording, failStep, succeedStep } from '@domain/Recording'
import { toRecordingDto, withQueuedSteps } from '@shared/ipc'

const recording = createRecording({ id: 'rec-1', startedAt: new Date('2026-09-06T14:30:00+09:00') })

describe('toRecordingDto', () => {
  it('予定の参加者名を素の配列で渡す', () => {
    const dto = toRecordingDto({ ...recording, participants: ['山田 太郎'] })

    expect(dto.participants).toEqual(['山田 太郎'])
  })

  it('参加者名の無い録音にはキーを作らない', () => {
    expect(toRecordingDto(recording)).not.toHaveProperty('participants')
  })
})

describe('withQueuedSteps', () => {
  const failed = {
    ...recording,
    status: 'failed' as const,
    steps: failStep(succeedStep(recording.steps, 'mix'), 'summarize', 'メモリ不足')
  }

  it('順番待ちのステップを queued にし、前回の失敗の理由は出さない', () => {
    const dto = withQueuedSteps(toRecordingDto(failed), ['summarize'])

    expect(dto.steps.summarize).toEqual({ status: 'queued' })
    expect(dto.steps.mix).toEqual({ status: 'done' })
  })

  it('順番待ちがあれば録音全体は処理中として扱う', () => {
    expect(withQueuedSteps(toRecordingDto(failed), ['summarize']).status).toBe('processing')
  })

  it('順番待ちが無ければそのまま返す', () => {
    const dto = toRecordingDto(failed)

    expect(withQueuedSteps(dto, [])).toBe(dto)
  })
})
