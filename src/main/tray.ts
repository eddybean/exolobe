import { Menu, Tray, nativeImage } from 'electron'
import { toMessage } from '@domain/errors'
import type { TransportController } from './ipc/handlers'
import { TRAY_ICON_PNG_BASE64 } from './trayIcon'

/**
 * メニューバーからの録音操作。
 *
 * 会議中はウィンドウを閉じている（あるいは他アプリの背後にある）ことが多いため、
 * 開始・停止だけはウィンドウ無しでも常に届く場所に置く。
 */
export const createTray = (controller: TransportController, showWindow: () => void): Tray => {
  // 32x32 を scaleFactor 2 として渡すと、16pt のアイコンとして扱われ Retina で滲まない。
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG_BASE64, 'base64'), {
    width: 32,
    height: 32,
    scaleFactor: 2
  })
  // テンプレート画像にしておくとライト／ダークの両方で自動的に色が合う。
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
  // 録音状態が変わったら表示を追従させる。クリック時だけの更新では、
  // ウィンドウ側で停止したときにトレイの表示が古いままになる。
  controller.onStateChanged(refresh)

  return tray
}
