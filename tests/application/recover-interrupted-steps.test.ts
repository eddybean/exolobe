import { describe, expect, it } from 'vitest'
import { RecoverInterruptedSteps } from '@application/usecases/RecoverInterruptedSteps'
import {
  PIPELINE_STEPS,
  createRecording,
  finishRecording,
  initialStepStates,
  startStep,
  succeedStep,
  type Recording
} from '@domain/Recording'
import { FakeRecordingRepository } from './fakes'

const startedAt = new Date('2026-09-27T23:12:00+09:00')

/** 要約だけが実行中のまま残った録音（要約の途中で処理プロセスが落ちた状態）。 */
const stuck = (id: string): Recording => {
  const steps = startStep(
    PIPELINE_STEPS.reduce((acc, step) => succeedStep(acc, step), initialStepStates()),
    'summarize'
  )
  return { ...finishRecording(createRecording({ id, startedAt }), 120_000), steps }
}

describe('RecoverInterruptedSteps', () => {
  it('実行中のまま残ったステップを失敗にし、録音全体も失敗として保存する', async () => {
    const repository = new FakeRecordingRepository()
    await repository.save(stuck('r1'))

    await new RecoverInterruptedSteps({ repository }).execute()

    const saved = await repository.find('r1')
    expect(saved?.steps.summarize.status).toBe('failed')
    expect(saved?.steps.summarize.reason).toEqual({ code: 'stepInterrupted' })
    expect(saved?.status).toBe('failed')
  })

  it('実行中のステップが無い録音は書き直さない（利用者の編集と競らないように）', async () => {
    const repository = new FakeRecordingRepository()
    const ready: Recording = {
      ...finishRecording(createRecording({ id: 'r2', startedAt }), 120_000),
      steps: PIPELINE_STEPS.reduce((acc, step) => succeedStep(acc, step), initialStepStates()),
      status: 'ready'
    }
    await repository.save(ready)
    const saves: string[] = []
    const original = repository.save.bind(repository)
    repository.save = async (recording) => {
      saves.push(recording.id)
      await original(recording)
    }

    await new RecoverInterruptedSteps({ repository }).execute()

    expect(saves).toEqual([])
  })
})
