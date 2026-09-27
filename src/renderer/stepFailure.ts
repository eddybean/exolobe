import { STEP_LABELS } from './format'

export interface StepFailure {
  readonly label: string
  readonly message: string
}

/**
 * 失敗したステップの表示材料。
 *
 * error は失敗時にしか入らないが、判定は status を正とする
 * （再実行で成功すると succeedStep が error を落とすため、status の方が実態に近い）。
 */
export const stepFailure = (
  step: string,
  state: { status: string; error?: string } | undefined
): StepFailure | undefined => {
  if (state?.status !== 'failed') return undefined

  return {
    label: STEP_LABELS[step] ?? step,
    // 原因不明のままツールチップを空にすると、失敗の理由を探す手掛かりごと消える。
    message: state.error ?? '原因を特定できませんでした。'
  }
}

/**
 * ツールチップとコピーに渡す本文。
 *
 * バッヂ内では 340px で省略されて読めなかったので、ここでは一切切り詰めない。
 * ホバーだけで文脈が分かるようステップ名を前置するが、infrastructure 側は既に
 * 「文字起こしに失敗しました: …」の形で投げてくるので、二重に名乗らせない。
 */
export const failureTooltip = (failure: StepFailure): string =>
  failure.message.includes(failure.label)
    ? failure.message
    : `${failure.label}が失敗しました: ${failure.message}`

/** 失敗を出す場所。そのステップが作るはずだったものが本来出る欄。 */
export type FailureArea = 'transcript' | 'summary' | 'audio'

/**
 * ステップと欄の対応。ミックスは文字起こしの入力ではなく（トラックごとに起こす）、
 * エンコードの入力なので音声の欄に置く。
 */
const FAILURE_AREAS: ReadonlyArray<readonly [string, FailureArea]> = [
  ['mix', 'audio'],
  ['transcribe', 'transcript'],
  ['diarize', 'transcript'],
  ['summarize', 'summary'],
  ['encode', 'audio']
]

/** その欄に出す失敗を、パイプラインの順に返す。 */
export const failuresIn = (
  area: FailureArea,
  steps: Readonly<Record<string, { status: string; error?: string } | undefined>>
): Array<StepFailure & { readonly step: string }> =>
  FAILURE_AREAS.flatMap(([step, stepArea]) => {
    const failure = stepArea === area ? stepFailure(step, steps[step]) : undefined
    return failure ? [{ step, ...failure }] : []
  })

/**
 * その欄で順番を待っているステップ。再実行を押すと失敗の表示が消えてここに移るので、
 * 押したことが受け付けられたと、ワーカーが動き出す前から分かる。
 */
export const queuedIn = (
  area: FailureArea,
  steps: Readonly<Record<string, { status: string } | undefined>>
): Array<{ readonly step: string; readonly label: string }> =>
  FAILURE_AREAS.flatMap(([step, stepArea]) =>
    stepArea === area && steps[step]?.status === 'queued'
      ? [{ step, label: STEP_LABELS[step] ?? step }]
      : []
  )
