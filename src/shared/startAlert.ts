/**
 * 開始忘れの確認バー（renderer）と OS 通知（main）で共有する文面（ADR-027 / ADR-041）。
 *
 * 同じ出来事を 2 か所で知らせるので、言い方がずれないよう 1 か所で組み立てる。
 */

const formatSpan = (ms: number): string => {
  if (ms < 60_000) return `${Math.round(ms / 1_000)} 秒`
  // 設定は 0.5 分刻みで入る。丸めると既定の 1 分半が「2 分」になり、設定と食い違う。
  const minutes = Math.round((ms / 60_000) * 10) / 10
  return `${minutes} 分`
}

export const startAlertMessage = (alert: {
  readonly micBusyDurationMs: number
  readonly eventTitle?: string | undefined
}): string =>
  alert.eventTitle === undefined
    ? `${formatSpan(alert.micBusyDurationMs)}以上、他のアプリがマイクを使っています。`
    : `「${alert.eventTitle}」の時間に、他のアプリがマイクを使っています。`

export const autoStartedMessage = (eventTitle: string): string =>
  `「${eventTitle}」の時間にマイクが使われていたため、自動で録音を始めました。録ってはいけない会議なら「停止して破棄」を押してください。`
