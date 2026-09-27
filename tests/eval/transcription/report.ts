/**
 * 評価の結果を基準（baseline.json）と並べて表にする。
 */
import type { DropReason } from '@infrastructure/transcription/WhisperCppTranscriber'

/** 1 つのシナリオを 1 つの構成で起こした結果。指標はどれも小さいほど良い。 */
export interface CaseResult {
  readonly scenario: string
  /** VAD の有無。既定は vad。no-vad は VAD モデルが無いときの逃げ道（ADR-020）。 */
  readonly config: 'vad' | 'no-vad'
  readonly cer: number
  readonly hallucinatedChars: number
  readonly missedUtterances: number
  readonly utterances: number
  readonly longestRepeatRun: number
  readonly dropped: Readonly<Record<DropReason, number>>
}

/**
 * 結果を左右する条件。どれかが違えば、音声か whisper が別物なので数値を比べられない。
 * `say` の声は macOS の版で変わる。
 */
export interface EvalEnvironment {
  readonly macos: string
  readonly whisper: string
  readonly model: string
  readonly voices: readonly string[]
}

export interface EvalReport {
  readonly environment: EvalEnvironment
  readonly results: readonly CaseResult[]
}

const signed = (delta: number, digits: number): string =>
  `${delta > 0 ? '+' : ''}${delta.toFixed(digits)}`

/** 値と、基準があれば差。差が 0 なら値だけ。 */
const withDelta = (value: number, base: number | undefined, digits = 0): string => {
  const shown = value.toFixed(digits)
  if (base === undefined || base.toFixed(digits) === shown) return shown
  return `${shown} (${signed(value - base, digits)})`
}

const formatDropped = (dropped: CaseResult['dropped']): string => {
  const parts = Object.entries(dropped)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${reason} ${count}`)
  return parts.length === 0 ? '-' : parts.join(', ')
}

/** Markdown の表。差は「今回 − 基準」なので、どの列もマイナスが改善。 */
export const formatComparison = (
  current: readonly CaseResult[],
  baseline: readonly CaseResult[] = []
): string => {
  const rows = current.map((result) => {
    const base = baseline.find(
      (candidate) => candidate.scenario === result.scenario && candidate.config === result.config
    )
    const missed = `${result.missedUtterances}/${result.utterances}`
    const missedDelta =
      base && base.missedUtterances !== result.missedUtterances
        ? ` (${signed(result.missedUtterances - base.missedUtterances, 0)})`
        : ''
    return [
      result.scenario,
      result.config,
      withDelta(result.cer, base?.cer, 3),
      withDelta(result.hallucinatedChars, base?.hallucinatedChars),
      missed + missedDelta,
      withDelta(result.longestRepeatRun, base?.longestRepeatRun),
      formatDropped(result.dropped)
    ]
  })

  return [
    '| シナリオ | 構成 | CER | 無音区間の文字数 | 取りこぼし | 同じ文の連続 | 取り除いた数 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((cells) => `| ${cells.join(' | ')} |`)
  ].join('\n')
}

/** 基準と違う条件を「基準 → 今回」で挙げる。 */
export const environmentDifferences = (
  current: EvalEnvironment,
  baseline: EvalEnvironment
): string[] =>
  (Object.keys(current) as (keyof EvalEnvironment)[]).flatMap((key) => {
    const now = [current[key]].flat().join(', ')
    const before = [baseline[key]].flat().join(', ')
    return now === before ? [] : [`${key}: ${before} → ${now}`]
  })
