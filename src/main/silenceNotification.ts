import { Notification } from 'electron'

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
    title: '録音を続けていますか？',
    body: `${params.minutes} 分以上、音が入っていません。会議が終わっているなら録音を停止してください。`,
    actions: [{ type: 'button', text: '録音を停止' }],
    closeButtonText: '続ける'
  })

  notification.on('action', () => params.onStop())
  notification.on('click', () => params.onShowWindow())
  notification.show()
}
