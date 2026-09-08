import { describe, expect, it } from 'vitest'
import {
  PIPELINE_STEPS,
  createRecording,
  failStep,
  finishRecording,
  initialStepStates,
  isProcessing,
  nextPendingStep,
  overallStatus,
  slugForRecording,
  startStep,
  succeedStep,
  tooShortRecording
} from '@domain/Recording'

const startedAt = new Date('2026-09-06T14:30:00+09:00')

describe('createRecording', () => {
  it('録音中の状態と全ステップ pending で開始する', () => {
    const recording = createRecording({ id: 'r1', startedAt })

    expect(recording.status).toBe('recording')
    expect(recording.durationMs).toBe(0)
    expect(Object.values(recording.steps).every((s) => s.status === 'pending')).toBe(true)
  })

  it('タイトル未指定なら開始日時から既定タイトルを付ける', () => {
    expect(createRecording({ id: 'r1', startedAt }).title).toBe('2026-09-06 14:30 の会議')
  })
})

describe('finishRecording', () => {
  it('録音時間を確定して処理中へ遷移する', () => {
    const recording = finishRecording(createRecording({ id: 'r1', startedAt }), 65_000)

    expect(recording.status).toBe('processing')
    expect(recording.durationMs).toBe(65_000)
  })
})

describe('ステップの状態遷移', () => {
  const processing = finishRecording(createRecording({ id: 'r1', startedAt }), 1000)

  it('nextPendingStep は定義順に未実行のステップを返す', () => {
    expect(nextPendingStep(processing.steps)).toBe(PIPELINE_STEPS[0])
  })

  it('成功したステップは done になり次へ進む', () => {
    const steps = succeedStep(startStep(processing.steps, 'mix'), 'mix')

    expect(steps.mix.status).toBe('done')
    expect(nextPendingStep(steps)).toBe('transcribe')
  })

  it('失敗したステップは理由を保持し、後続へは進まない', () => {
    const steps = failStep(processing.steps, 'transcribe', 'whisper-cli が見つかりません')

    expect(steps.transcribe).toEqual({
      status: 'failed',
      error: 'whisper-cli が見つかりません'
    })
    expect(overallStatus(steps)).toBe('failed')
  })

  it('全ステップ完了で ready になる', () => {
    const steps = PIPELINE_STEPS.reduce((acc, step) => succeedStep(acc, step), initialStepStates())

    expect(overallStatus(steps)).toBe('ready')
    expect(nextPendingStep(steps)).toBeUndefined()
  })

  it('一部が失敗しても残りが完了していれば failed のままにする', () => {
    const steps = PIPELINE_STEPS.reduce(
      (acc, step) => (step === 'summarize' ? failStep(acc, step, 'ollama 未起動') : succeedStep(acc, step)),
      initialStepStates()
    )

    expect(overallStatus(steps)).toBe('failed')
  })

  it('実行中のステップがあれば processing を返す', () => {
    expect(isProcessing(startStep(initialStepStates(), 'mix'))).toBe(true)
    expect(overallStatus(startStep(initialStepStates(), 'mix'))).toBe('processing')
  })
})

describe('tooShortRecording', () => {
  it('1 分に満たない録音は理由を返す', () => {
    expect(tooShortRecording(59_999)).toBe(
      '録音時間が 59 秒しかありません。1 分未満の録音は処理しません。'
    )
  })

  it('ちょうど 1 分は処理する', () => {
    expect(tooShortRecording(60_000)).toBeUndefined()
  })

  it('押し間違えて即停止した録音も理由を返す', () => {
    expect(tooShortRecording(0)).toBe(
      '録音時間が 0 秒しかありません。1 分未満の録音は処理しません。'
    )
  })

  it('録音時間を測れなかった場合は止めない', () => {
    // 見積もれないことを理由に本物の録音を捨てる方が損害が大きい。
    expect(tooShortRecording(Number.NaN)).toBeUndefined()
  })
})

describe('slugForRecording', () => {
  it('日時と id 先頭8桁から保存ディレクトリ名を作る（タイトルは使わない）', () => {
    expect(slugForRecording(startedAt, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(
      '2026-09-06_1430-a1b2c3d4'
    )
  })

  it('id が短い場合はそのまま接尾辞にする', () => {
    expect(slugForRecording(startedAt, 'r1')).toBe('2026-09-06_1430-r1')
  })

  it('同時刻でも id が異なればディレクトリ名が衝突しない', () => {
    const first = slugForRecording(startedAt, 'aaaaaaaa-0000-0000-0000-000000000000')
    const second = slugForRecording(startedAt, 'bbbbbbbb-0000-0000-0000-000000000000')

    expect(first).not.toBe(second)
  })
})
