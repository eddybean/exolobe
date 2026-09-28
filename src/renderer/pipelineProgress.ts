import { PIPELINE_STEPS } from '@domain/Recording'
import type { ProgressEventDto } from '@shared/ipc'
import { stepLabel } from '@shared/i18n/steps'
import { pipelineText } from './i18n/pipeline'
import { locale } from './i18n/locale'

/**
 * 処理状況（タイトル下のピル）を出すか。
 *
 * 録音中はまだ何も始まっておらず、止まった後の失敗は各欄に出すので、処理中だけ出す。
 */
export const showsPipelineProgress = (recordingStatus: string): boolean =>
  recordingStatus === 'processing'

/** 1 つの録音について、いま動いているステップの割合の標本。 */
export interface ProgressSample {
  readonly step: string
  readonly fraction: number
  /** 残り時間の見積もりの起点。割合が動き出した時点を基準にする。 */
  readonly firstFraction: number
  readonly firstAtMs: number
}

/** 録音 ID ごとの標本。 */
export type ProgressSamples = Readonly<Record<string, ProgressSample>>

/** 進捗の通知を標本へ畳み込む。 */
export const applyProgressEvent = (
  samples: ProgressSamples,
  event: ProgressEventDto,
  nowMs: number
): ProgressSamples => {
  const { [event.recordingId]: current, ...others } = samples

  // 割合の無い通知はステップの切り替わり（開始・完了・失敗）。古い割合を見せ続けない。
  if (event.status !== 'running' || event.fraction === undefined) return others

  const sameStep = current?.step === event.step
  return {
    ...others,
    [event.recordingId]: {
      step: event.step,
      fraction: event.fraction,
      firstFraction: sameStep ? current.firstFraction : event.fraction,
      firstAtMs: sameStep ? current.firstAtMs : nowMs
    }
  }
}

/** 見積もりを出すのに要る最小の進み。これ未満では速さが定まらず、数字が暴れる。 */
const MIN_PROGRESS_FOR_ESTIMATE = 0.05

/** 最初の標本からの速さで残り時間を見積もる。見積もれなければ undefined。 */
export const estimateRemainingMs = (
  sample: Omit<ProgressSample, 'step'> & { step?: string },
  nowMs: number
): number | undefined => {
  const progressed = sample.fraction - sample.firstFraction
  if (progressed < MIN_PROGRESS_FOR_ESTIMATE) return undefined

  const msPerFraction = (nowMs - sample.firstAtMs) / progressed
  return Math.round(msPerFraction * (1 - sample.fraction))
}

/** 見積もりは粗いので、分単位で切り上げて「約」を付ける。 */
export const formatRemaining = (ms: number): string =>
  ms < 60_000
    ? pipelineText().remainingUnderMinute
    : pipelineText().remainingAbout(Math.ceil(ms / 60_000))

/**
 * ピルの文言。閉じたままでも用が足りるよう、いま動いているステップと残り時間を 1 行にする。
 *
 * 割合は同じステップの標本のときだけ添える。切り替わりの通知より先に描画されると、
 * 前のステップの割合が次のステップに付いて見えるため。
 */
export const pipelinePillLabel = (
  steps: Readonly<Record<string, { status: string } | undefined>>,
  sample: Pick<ProgressSample, 'step' | 'fraction'> | undefined,
  remainingMs: number | undefined
): string => {
  const running = PIPELINE_STEPS.find((step) => steps[step]?.status === 'running')
  // ワーカーはジョブを直列に捌くので、他の録音の処理が終わるのを待っている間がある。
  if (!running) return pipelineText().queued

  const fraction = sample?.step === running ? ` ${Math.round(sample.fraction * 100)}%` : ''
  const remaining =
    remainingMs === undefined ? '' : `${pipelineText().separator}${formatRemaining(remainingMs)}`
  return pipelineText().running(stepLabel(running, locale()), fraction, remaining)
}
