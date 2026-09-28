import { PIPELINE_STEPS, type PipelineStep } from '@domain/Recording'
import type { Locale } from './locale'

const LABELS: Readonly<Record<Locale, Readonly<Record<PipelineStep, string>>>> = {
  ja: {
    mix: 'ミックス',
    transcribe: '文字起こし',
    diarize: '話者識別',
    summarize: '要約',
    encode: 'エンコード'
  },
  en: {
    mix: 'Mixing',
    transcribe: 'Transcription',
    diarize: 'Speaker identification',
    summarize: 'Summary',
    encode: 'Encoding'
  }
}

/** パイプラインのステップの表示名。知らないステップ（新しい版の保存データ）は名前をそのまま返す。 */
export const stepLabel = (step: string, locale: Locale): string =>
  isPipelineStep(step) ? LABELS[locale][step] : step

const isPipelineStep = (step: string): step is PipelineStep =>
  PIPELINE_STEPS.some((known) => known === step)
