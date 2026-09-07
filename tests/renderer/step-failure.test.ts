import { describe, expect, it } from 'vitest'
import { failureTooltip, stepFailure } from '@renderer/stepFailure'

/**
 * ステップバッヂはエラー文言を中に描かなくなった（省略されて読めないため）。
 * 代わりにツールチップとコピーへ全文を渡すので、その組み立てをここで固定する。
 */
describe('stepFailure', () => {
  it('失敗していないステップは失敗として扱わない', () => {
    expect(stepFailure('transcribe', undefined)).toBeUndefined()
    expect(stepFailure('transcribe', { status: 'pending' })).toBeUndefined()
    expect(stepFailure('transcribe', { status: 'running' })).toBeUndefined()
    expect(stepFailure('transcribe', { status: 'done' })).toBeUndefined()
  })

  it('失敗したステップはラベルと本文を返す', () => {
    expect(stepFailure('transcribe', { status: 'failed', error: 'モデルを読み込めません。' })).toEqual(
      { label: '文字起こし', message: 'モデルを読み込めません。' }
    )
  })

  it('error が無い失敗でもツールチップが空にならないよう既定文言を入れる', () => {
    const failure = stepFailure('summarize', { status: 'failed' })

    expect(failure?.label).toBe('要約')
    expect(failure?.message).not.toBe('')
  })

  it('未知のステップ名はそのままラベルにする', () => {
    expect(stepFailure('unknown', { status: 'failed', error: 'x' })?.label).toBe('unknown')
  })
})

describe('failureTooltip', () => {
  it('どのステップの話か分かるようラベルを前置する', () => {
    expect(failureTooltip({ label: '文字起こし', message: 'モデルを読み込めません。' })).toBe(
      '文字起こしが失敗しました: モデルを読み込めません。'
    )
  })

  it('本文が既にステップ名を名乗っているなら前置しない', () => {
    // infrastructure 側は「文字起こしに失敗しました: …」の形で投げてくる。
    // 機械的に前置すると「文字起こしが失敗しました: 文字起こしに失敗しました: …」になる。
    const message = '文字起こしに失敗しました: whisper-cli exited with code 1'

    expect(failureTooltip({ label: '文字起こし', message })).toBe(message)
  })

  it('別のステップ名を含むだけの本文には前置する', () => {
    // 依存で止まった話者識別の本文は「文字起こし」を含むが、主語は話者識別。
    expect(
      failureTooltip({
        label: '話者識別',
        message: '前のステップ（文字起こし）が失敗したため実行しませんでした。'
      })
    ).toBe('話者識別が失敗しました: 前のステップ（文字起こし）が失敗したため実行しませんでした。')
  })

  it('長い本文でも切り詰めない（バッヂ内では読めなかった全文を渡すのが目的）', () => {
    const message =
      'メモリが不足しているため要約を実行しませんでした（必要 約6.2 GB / 空き 約2.1 GB）。' +
      '他のアプリを終了してから再実行してください。設定の「メモリ保護」で判定の厳しさを変えられます。'

    expect(failureTooltip({ label: '要約', message })).toContain(message)
  })
})
