import { Notification } from 'electron'
import { text } from './i18n'

/**
 * 「無音が続いている」ことを OS の通知で知らせる。
 *
 * 会議中はウィンドウを閉じている（あるいは他アプリの背後にある）ことが多く、
 * アプリ内の表示だけでは止め忘れに気づけない。通知からその場で止められるよう、
 * macOS の通知ボタンに停止を割り当てる。
 *
 * 通知が使えない環境（許可されていない等）でも呼び出し側を壊さないよう、
 * ここでは投げずに黙って何もしない。アプリ内の確認表示が残るため気づけなくならない。
 */
export const notifySilence = (params: {
  minutes: number
  onStop: () => void
  onShowWindow: () => void
}): void => {
  if (!Notification.isSupported()) return

  const notification = new Notification({
    title: text().notification.silenceTitle,
    body: text().notification.silenceBody(params.minutes),
    actions: [{ type: 'button', text: text().notification.stop }],
    closeButtonText: text().notification.keepGoing
  })

  notification.on('action', () => params.onStop())
  notification.on('click', () => params.onShowWindow())
  notification.show()
}
