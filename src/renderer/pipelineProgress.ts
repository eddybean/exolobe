import type { ProgressEventDto } from '@shared/ipc'

const PIPELINE_STEPS = ['mix', 'transcribe', 'diarize', 'summarize', 'encode'] as const

/** 処理状況の欄に出すステップ。何も出さないなら空。 */
export const visiblePipelineSteps = (
  steps: Readonly<Record<string, { status: string } | undefined>>
): string[] => {
  const statusOf = (step: string): string => steps[step]?.status ?? 'pending'

  // 動いている（これから動く）間は、どこまで進んだかが分かるよう全部並べる。
  if (PIPELINE_STEPS.some((step) => ['running', 'pending'].includes(statusOf(step)))) {
    return [...PIPELINE_STEPS]
  }
  // 終わった後に残す価値があるのは、手を打てる失敗だけ。
  return PIPELINE_STEPS.filter((step) => statusOf(step) === 'failed')
}

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
  ms < 60_000 ? '残り 1 分未満' : `残り約 ${Math.ceil(ms / 60_000)} 分`
