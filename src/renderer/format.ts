/** 経過時間・録音長を mm:ss（1 時間以上は h:mm:ss）で表す。 */
export const formatDuration = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const pad = (value: number): string => String(value).padStart(2, '0')
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const seconds = total % 60

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

/** 一覧に出す日時。年は今年なら省く。 */
export const formatDateTime = (iso: string): string => {
  const date = new Date(iso)
  const sameYear = date.getFullYear() === new Date().getFullYear()

  return new Intl.DateTimeFormat('ja-JP', {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

export const STATUS_LABELS: Record<string, string> = {
  recording: '録音中',
  processing: '処理中',
  ready: '完了',
  failed: '一部失敗'
}

export const STEP_LABELS: Record<string, string> = {
  mix: 'ミックス',
  transcribe: '文字起こし',
  diarize: '話者識別',
  summarize: '要約',
  encode: 'エンコード'
}
