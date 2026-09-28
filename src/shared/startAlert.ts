import type { Locale } from './i18n/locale'

/**
 * 開始忘れの確認バー（renderer）と OS 通知（main）で共有する文面（ADR-027 / ADR-041）。
 *
 * 同じ出来事を 2 か所で知らせるので、言い方がずれないよう 1 か所で組み立てる。
 */

const formatSpan = (ms: number, locale: Locale): string => {
  if (ms < 60_000) {
    const seconds = Math.round(ms / 1_000)
    return locale === 'ja' ? `${seconds} 秒` : `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
  }
  // 設定は 0.5 分刻みで入る。丸めると既定の 1 分半が「2 分」になり、設定と食い違う。
  const minutes = Math.round((ms / 60_000) * 10) / 10
  return locale === 'ja' ? `${minutes} 分` : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

export const startAlertMessage = (
  alert: {
    readonly micBusyDurationMs: number
    readonly eventTitle?: string | undefined
  },
  locale: Locale
): string => {
  if (locale === 'en') {
    return alert.eventTitle === undefined
      ? `Another app has been using the microphone for ${formatSpan(alert.micBusyDurationMs, locale)} or more.`
      : `Another app is using the microphone during “${alert.eventTitle}”.`
  }
  return alert.eventTitle === undefined
    ? `${formatSpan(alert.micBusyDurationMs, locale)}以上、他のアプリがマイクを使っています。`
    : `「${alert.eventTitle}」の時間に、他のアプリがマイクを使っています。`
}

export const autoStartedMessage = (eventTitle: string, locale: Locale): string =>
  locale === 'en'
    ? `Recording started automatically because the microphone was in use during “${eventTitle}”. If this meeting must not be recorded, click “Stop and Discard”.`
    : `「${eventTitle}」の時間にマイクが使われていたため、自動で録音を始めました。録ってはいけない会議なら「停止して破棄」を押してください。`
