import { Notification } from 'electron'
import { autoStartedMessage } from '@shared/startAlert'
import { appLocale, text } from './i18n'

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
    title: text().notification.startTitle,
    body: text().notification.startBody(params.message),
    actions: [{ type: 'button', text: text().notification.start }],
    closeButtonText: text().notification.notNow
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
    title: text().notification.autoStartedTitle,
    body: autoStartedMessage(params.eventTitle, appLocale()),
    actions: [{ type: 'button', text: text().notification.stopAndDiscard }],
    closeButtonText: text().notification.keepGoing
  })

  notification.on('action', () => params.onDiscard())
  notification.on('click', () => params.onShowWindow())
  notification.show()
}
