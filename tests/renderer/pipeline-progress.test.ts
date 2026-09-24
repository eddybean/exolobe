import { describe, expect, it } from 'vitest'
import {
  applyProgressEvent,
  estimateRemainingMs,
  formatRemaining,
  visiblePipelineSteps,
  type ProgressSamples
} from '@renderer/pipelineProgress'

const steps = (
  overrides: Partial<Record<string, { status: string; error?: string }>> = {}
): Record<string, { status: string; error?: string }> => ({
  mix: { status: 'done' },
  transcribe: { status: 'done' },
  diarize: { status: 'done' },
  summarize: { status: 'done' },
  encode: { status: 'done' },
  ...overrides
})

/**
 * 処理状況の欄は、処理中は全ステップを縦に並べ、終わったら場所を空ける。
 * 完了した録音で 5 行を出し続けると、見るたびに本文が押し下げられるだけになる。
 */
describe('visiblePipelineSteps', () => {
  it('すべて完了していれば何も出さない', () => {
    expect(visiblePipelineSteps(steps())).toEqual([])
  })

  it('処理中は全ステップを順に出す（どこまで進んだか分かるように）', () => {
    expect(
      visiblePipelineSteps(steps({ transcribe: { status: 'running' }, diarize: { status: 'pending' } }))
    ).toEqual(['mix', 'transcribe', 'diarize', 'summarize', 'encode'])
  })

  it('処理が終わって失敗が残っていれば、失敗したステップだけを出す', () => {
    expect(
      visiblePipelineSteps(steps({ summarize: { status: 'failed', error: 'メモリ不足' } }))
    ).toEqual(['summarize'])
  })
})

describe('applyProgressEvent', () => {
  it('割合つきの通知を、その録音の最初の標本と最新の値として持つ', () => {
    let samples: ProgressSamples = {}
    samples = applyProgressEvent(
      samples,
      { recordingId: 'r1', step: 'transcribe', status: 'running', fraction: 0.1 },
      1_000
    )
    samples = applyProgressEvent(
      samples,
      { recordingId: 'r1', step: 'transcribe', status: 'running', fraction: 0.3 },
      5_000
    )

    expect(samples['r1']).toEqual({
      step: 'transcribe',
      fraction: 0.3,
      firstFraction: 0.1,
      firstAtMs: 1_000
    })
  })

  it('ステップが終わるか失敗したら割合を捨てる（次のステップへ持ち越さない）', () => {
    const running = applyProgressEvent(
      {},
      { recordingId: 'r1', step: 'transcribe', status: 'running', fraction: 0.5 },
      1_000
    )

    expect(
      applyProgressEvent(running, { recordingId: 'r1', step: 'transcribe', status: 'done' }, 2_000)
    ).toEqual({})
    expect(
      applyProgressEvent(
        running,
        { recordingId: 'r1', step: 'transcribe', status: 'failed', error: 'x' },
        2_000
      )
    ).toEqual({})
  })

  it('別のステップが始まったら、そのステップとして数え直す', () => {
    const running = applyProgressEvent(
      {},
      { recordingId: 'r1', step: 'transcribe', status: 'running', fraction: 0.9 },
      1_000
    )
    const next = applyProgressEvent(
      running,
      { recordingId: 'r1', step: 'diarize', status: 'running', fraction: 0.2 },
      9_000
    )

    expect(next['r1']).toEqual({ step: 'diarize', fraction: 0.2, firstFraction: 0.2, firstAtMs: 9_000 })
  })

  it('他の録音の標本には触れない', () => {
    const r1 = applyProgressEvent(
      {},
      { recordingId: 'r1', step: 'transcribe', status: 'running', fraction: 0.5 },
      1_000
    )
    const after = applyProgressEvent(r1, { recordingId: 'r2', step: 'mix', status: 'done' }, 2_000)

    expect(after['r1']?.fraction).toBe(0.5)
  })
})

/**
 * 残り時間は「最初の標本から今までの速さ」で見積もる。モデルの読み込みなど
 * 割合が動き出す前の時間を含めると、序盤の見積もりが大きく外れるため。
 */
describe('estimateRemainingMs', () => {
  const sample = { step: 'transcribe', firstFraction: 0.1, firstAtMs: 0 }

  it('進んだ割合と経過時間から残りを見積もる', () => {
    // 60 秒で 0.1 → 0.4（0.3 進んだ）。残り 0.6 は 120 秒。
    expect(estimateRemainingMs({ ...sample, fraction: 0.4 }, 60_000)).toBe(120_000)
  })

  it('ほとんど進んでいないうちは見積もらない（数字が暴れるため）', () => {
    expect(estimateRemainingMs({ ...sample, fraction: 0.12 }, 60_000)).toBeUndefined()
  })
})

describe('formatRemaining', () => {
  it('分単位に切り上げて出す', () => {
    expect(formatRemaining(125_000)).toBe('残り約 3 分')
  })

  it('1 分未満はそう書く', () => {
    expect(formatRemaining(20_000)).toBe('残り 1 分未満')
  })
})
