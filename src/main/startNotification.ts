import { Notification } from 'electron'
import { autoStartedMessage } from '@shared/startAlert'

/**
 * 「会議が始まっていそうなのに録音していない」ことを OS の通知で知らせる。
 *
 * 会議中はこのアプリのウィンドウを見ていないので、通知で届かないと意味がない。
 * その場で録音を始められるよう、通知ボタンに開始を割り当てる。
 *
 * notifySilence と同じく、通知が使えない環境でも呼び出し側を壊さないよう
 * 黙って何もしない。アプリ内の確認バーが残るため気づけなくならない。
 */
export const notifyMeetingStart = (params: {
  /** 何を見て促しているか（startAlertMessage）。確認バーと同じ文面にする。 */
  message: string
  onStart: () => void
  onShowWindow: () => void
}): void => {
  if (!Notification.isSupported()) return

  const notification = new Notification({
    title: '録音していません',
    body: `${params.message}会議が始まっているなら録音を開始してください。`,
    actions: [{ type: 'button', text: '録音を開始' }],
    closeButtonText: '今はしない'
  })

  notification.on('action', () => params.onStart())
  notification.on('click', () => params.onShowWindow())
  notification.show()
}

/**
 * 録音を自動で始めたことを知らせる（ADR-041）。
 *
 * 利用者がボタンを押さずに録音が始まるので、始まったことを必ず知らせ、その場で
 * 取り消せるようにする。録音禁止の会議を誤って録ったなら、パイプラインにかける前に
 * 痕跡ごと消せなければならない。閉じるボタンは「続ける」で、何もしない。
 */
export const notifyAutoStarted = (params: {
  eventTitle: string
  onDiscard: () => void
  onShowWindow: () => void
}): void => {
  if (!Notification.isSupported()) return

  const notification = new Notification({
    title: '録音を開始しました',
    body: autoStartedMessage(params.eventTitle),
    actions: [{ type: 'button', text: '停止して破棄' }],
    closeButtonText: '続ける'
  })

  notification.on('action', () => params.onDiscard())
  notification.on('click', () => params.onShowWindow())
  notification.show()
}
