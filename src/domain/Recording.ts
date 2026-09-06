/** 停止後に順に実行されるパイプラインのステップ。配列の順序が実行順を定義する。 */
export const PIPELINE_STEPS = ['mix', 'transcribe', 'diarize', 'summarize', 'encode'] as const

export type PipelineStep = (typeof PIPELINE_STEPS)[number]

export type StepStatus = 'pending' | 'running' | 'done' | 'failed'

export interface StepState {
  readonly status: StepStatus
  /** 失敗時のみ設定される。詳細画面での個別リトライの判断材料になる。 */
  readonly error?: string
}

export type StepStates = Readonly<Record<PipelineStep, StepState>>

export type RecordingStatus = 'recording' | 'processing' | 'ready' | 'failed'

export interface Recording {
  readonly id: string
  readonly title: string
  readonly startedAt: Date
  readonly durationMs: number
  readonly status: RecordingStatus
  readonly steps: StepStates
  /** 保存先ルートからの相対ディレクトリ名。 */
  readonly slug: string
}

const pad = (value: number): string => String(value).padStart(2, '0')

const formatDateTime = (date: Date): { date: string; time: string } => ({
  date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
  time: `${pad(date.getHours())}${pad(date.getMinutes())}`
})

export const initialStepStates = (): StepStates =>
  Object.fromEntries(
    PIPELINE_STEPS.map((step) => [step, { status: 'pending' as const }])
  ) as StepStates

/**
 * 保存ディレクトリ名を組み立てる。タイトルは後から自由にリネームできて
 * ディレクトリ名には反映されないため、ここでは使わない。
 * 開始日時 + id 先頭8桁だけで一意なディレクトリ名にする。
 */
export const slugForRecording = (startedAt: Date, id: string): string => {
  const { date, time } = formatDateTime(startedAt)
  const idSuffix = id.slice(0, 8)

  return `${date}_${time}-${idSuffix}`
}

export const defaultTitle = (startedAt: Date): string => {
  const { date } = formatDateTime(startedAt)
  return `${date} ${pad(startedAt.getHours())}:${pad(startedAt.getMinutes())} の会議`
}

export const createRecording = (params: {
  id: string
  startedAt: Date
  title?: string
}): Recording => {
  const title = params.title?.trim() || defaultTitle(params.startedAt)

  return {
    id: params.id,
    title,
    startedAt: params.startedAt,
    durationMs: 0,
    status: 'recording',
    steps: initialStepStates(),
    slug: slugForRecording(params.startedAt, params.id)
  }
}

export const finishRecording = (recording: Recording, durationMs: number): Recording => ({
  ...recording,
  durationMs,
  status: 'processing'
})

const setStep = (steps: StepStates, step: PipelineStep, state: StepState): StepStates => ({
  ...steps,
  [step]: state
})

export const startStep = (steps: StepStates, step: PipelineStep): StepStates =>
  setStep(steps, step, { status: 'running' })

export const succeedStep = (steps: StepStates, step: PipelineStep): StepStates =>
  setStep(steps, step, { status: 'done' })

export const failStep = (steps: StepStates, step: PipelineStep, error: string): StepStates =>
  setStep(steps, step, { status: 'failed', error })

/** 次に実行すべきステップ。全て完了、または失敗で止まっている場合は undefined。 */
export const nextPendingStep = (steps: StepStates): PipelineStep | undefined =>
  PIPELINE_STEPS.find((step) => steps[step].status === 'pending')

export const isProcessing = (steps: StepStates): boolean =>
  PIPELINE_STEPS.some((step) => steps[step].status === 'running')

/**
 * ステップ群から録音全体の状態を導出する。
 * 実行中が最優先、次に失敗（後続が成功していても失敗は隠さない）、最後に完了。
 */
export const overallStatus = (steps: StepStates): Exclude<RecordingStatus, 'recording'> => {
  if (isProcessing(steps)) return 'processing'
  if (PIPELINE_STEPS.some((step) => steps[step].status === 'failed')) return 'failed'
  if (PIPELINE_STEPS.every((step) => steps[step].status === 'done')) return 'ready'
  return 'processing'
}
