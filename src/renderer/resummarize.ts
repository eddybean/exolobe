/**
 * 「再要約」ボタンの状態。
 *
 * - `unavailable`: 文字起こしがまだ無い。要約する材料が無い。
 * - `summarizing`: 要約が走っている最中。
 * - `queued`: 要約が順番を待っている。押した直後から、受け付けたことを見せる。
 * - `busy`: 他のステップが走っている。ワーカーはジョブを直列に捌くので、
 *   ここで押せても待たされるだけで、押した手応えだけが嘘になる。
 * - `ready`: 押せる。
 */
export type ResummarizeState = 'ready' | 'summarizing' | 'queued' | 'busy' | 'unavailable'

/**
 * ステップの再実行そのものは失敗していなくても許されている（ProcessRecording は
 * 対象ステップの過去の成否を見ない）。話者名を直したあとに要約を作り直すのが
 * まさにその用途なので、ここでも「完了済みだから押せない」とはしない。
 */
export const resummarizeState = (
  steps: Readonly<Record<string, { status: string } | undefined>>,
  hasTranscript: boolean
): ResummarizeState => {
  if (steps.summarize?.status === 'running') return 'summarizing'
  if (steps.summarize?.status === 'queued') return 'queued'
  if (Object.values(steps).some((state) => state?.status === 'running' || state?.status === 'queued')) {
    return 'busy'
  }
  if (!hasTranscript) return 'unavailable'

  return 'ready'
}

/**
 * 要約を手で直せるか。要約が走っている間やこれから走る間は、直しても
 * 生成結果で上書きされて黙って消えるので直させない。
 * 失敗したときは、生成を諦めて自分で書く道を残す。
 */
export const canEditSummary = (steps: Readonly<Record<string, { status: string } | undefined>>): boolean =>
  steps.summarize?.status === 'done' || steps.summarize?.status === 'failed'
