import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '@renderer/i18n/locale'
import { failureTooltip, failuresIn, queuedIn, stepFailure } from '@renderer/stepFailure'

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
    expect(stepFailure('transcribe', { status: 'failed', error: 'モデルを読み込めません。' })).toEqual({
      label: '文字起こし',
      message: 'モデルを読み込めません。'
    })
  })

  it('error が無い失敗でもツールチップが空にならないよう既定文言を入れる', () => {
    const failure = stepFailure('summarize', { status: 'failed' })

    expect(failure?.label).toBe('要約')
    expect(failure?.message).not.toBe('')
  })

  it('理由のある失敗は、保存されたコードではなく今の言語の文言にする', () => {
    const state = {
      status: 'failed',
      error: 'stepBlocked',
      reason: { code: 'stepBlocked', blocker: 'transcribe' }
    } as const

    expect(stepFailure('diarize', state)).toEqual({
      label: '話者識別',
      message: '前のステップ（文字起こし）が失敗したため実行しませんでした。'
    })
  })

  it('知らない理由（新しい版の保存データ）は保存された error に戻る', () => {
    const state = { status: 'failed', error: 'fromTheFuture', reason: { code: 'fromTheFuture' } }

    expect(stepFailure('mix', state as never)?.message).toBe('fromTheFuture')
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
 * 失敗は、そのステップが作るはずだったものの場所に出す。上部にまとめて出すと、
 * 何が欠けているのかを本文と見比べて探すことになる。
 */
describe('failuresIn', () => {
  it('失敗が無ければどこにも出さない', () => {
    expect(failuresIn('transcript', steps())).toEqual([])
    expect(failuresIn('summary', steps())).toEqual([])
    expect(failuresIn('audio', steps())).toEqual([])
  })

  it('要約の失敗は要約の欄に出す', () => {
    const failed = steps({ summarize: { status: 'failed', error: 'メモリ不足' } })

    expect(failuresIn('summary', failed)).toEqual([{ step: 'summarize', label: '要約', message: 'メモリ不足' }])
    expect(failuresIn('transcript', failed)).toEqual([])
    expect(failuresIn('audio', failed)).toEqual([])
  })

  it('文字起こしと話者識別の失敗は文字起こしの欄に、順に出す', () => {
    const failed = steps({
      transcribe: { status: 'failed', error: 'a' },
      diarize: { status: 'failed', error: 'b' }
    })

    expect(failuresIn('transcript', failed).map((failure) => failure.step)).toEqual(['transcribe', 'diarize'])
  })

  it('ミックスとエンコードの失敗は音声の欄に出す（エンコードはミックスに依存する）', () => {
    const failed = steps({
      mix: { status: 'failed', error: 'a' },
      encode: { status: 'failed', error: 'b' }
    })

    expect(failuresIn('audio', failed).map((failure) => failure.step)).toEqual(['mix', 'encode'])
    expect(failuresIn('transcript', failed)).toEqual([])
  })
})

describe('queuedIn', () => {
  it('再実行を受け付けたステップを、失敗を出していた欄に出す', () => {
    const queued = steps({ summarize: { status: 'queued' } })

    expect(queuedIn('summary', queued)).toEqual([{ step: 'summarize', label: '要約' }])
    expect(queuedIn('transcript', queued)).toEqual([])
    expect(failuresIn('summary', queued)).toEqual([])
  })

  it('順番待ちが無ければ何も出さない', () => {
    expect(queuedIn('audio', steps({ encode: { status: 'running' } }))).toEqual([])
  })
})

describe('英語の UI', () => {
  afterEach(() => setLocale('ja'))

  it('ラベル・本文・ツールチップを英語で組み立てる', () => {
    setLocale('en')
    const failure = stepFailure('diarize', {
      status: 'failed',
      error: 'stepBlocked',
      reason: { code: 'stepBlocked', blocker: 'transcribe' }
    })

    expect(failure).toEqual({
      label: 'Speaker identification',
      message: 'Skipped because an earlier step (Transcription) failed.'
    })
    expect(failureTooltip({ label: 'Summary', message: 'Out of memory.' })).toBe('Summary failed: Out of memory.')
    expect(stepFailure('summarize', { status: 'failed' })?.message).toBe('The cause could not be determined.')
  })
})
