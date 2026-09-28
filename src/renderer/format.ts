import { formatText } from './i18n/format'
import { intlLocale, locale } from './i18n/locale'

export { formatBytes } from '@domain/ModelCatalog'

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

  return new Intl.DateTimeFormat(intlLocale(), {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
    // 日本語は 24 時間制で桁を揃え、英語は 12 時間制の慣習どおり時を 0 で埋めない。
    hour: locale() === 'ja' ? '2-digit' : 'numeric',
    minute: '2-digit'
  }).format(date)
}

/** 一覧の状態バッジ。知らない状態（新しい版の保存データ）は状態名をそのまま出す。 */
export const statusLabel = (status: string): string => {
  const labels: Readonly<Record<string, string>> = formatText().status
  return labels[status] ?? status
}
