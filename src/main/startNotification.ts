import { Notification } from 'electron'

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
  minutes: number
  onStart: () => void
  onShowWindow: () => void
}): void => {
  if (!Notification.isSupported()) return

  const notification = new Notification({
    title: '録音していません',
    body: `${params.minutes} 分以上、他のアプリがマイクを使っています。会議が始まっているなら録音を開始してください。`,
    actions: [{ type: 'button', text: '録音を開始' }],
    closeButtonText: '今はしない'
  })

  notification.on('action', () => params.onStart())
  notification.on('click', () => params.onShowWindow())
  notification.show()
}
