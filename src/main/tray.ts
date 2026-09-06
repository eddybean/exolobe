import { Menu, Tray, nativeImage } from 'electron'
import { toMessage } from '@domain/errors'
import type { TransportController } from './ipc/handlers'

/**
 * メニューバーからの録音操作。
 *
 * 会議中はウィンドウを閉じている（あるいは他アプリの背後にある）ことが多いため、
 * 開始・停止だけはウィンドウ無しでも常に届く場所に置く。
 */
export const createTray = (controller: TransportController, showWindow: () => void): Tray => {
  // テンプレート画像にしておくとライト／ダークの両方で自動的に色が合う。
  const icon = nativeImage.createFromDataURL(ICON_DATA_URL)
  icon.setTemplateImage(true)

  const tray = new Tray(icon)
  tray.setToolTip('会議レコーダー')

  const refresh = (): void => {
    const state = controller.state()

    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: state.active ? `録音中: ${state.title ?? ''}` : '停止中',
          enabled: false
        },
        { type: 'separator' },
        {
          label: state.active ? '録音を停止' : '録音を開始',
          click: () => {
            const action = state.active ? controller.stop() : controller.start()
            action.then(refresh).catch((error: unknown) => {
              console.error(toMessage(error))
              refresh()
            })
          }
        },
        { label: 'ウィンドウを表示', click: showWindow },
        { type: 'separator' },
        { label: '終了', role: 'quit' }
      ])
    )
  }

  refresh()
  // 状態はここでしか変わらないため、開くたびに作り直して同期を保つ。
  tray.on('click', refresh)

  return tray
}

/** 16x16 の丸（録音インジケータ）。外部ファイルを持たずに済ませる。 */
const ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAV0lEQVQ4jWNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUUAmAAAcvwABg0Y5ewAAAABJRU5ErkJggg=='
