import { Menu, Tray, nativeImage, type NativeImage } from 'electron'
import type { TransportController } from './ipc/handlers'
import { trayIconFor } from './trayIcon'

/**
 * メニューバーからの録音操作。
 *
 * 会議中はウィンドウを閉じている（あるいは他アプリの背後にある）ことが多いため、
 * 開始・停止だけはウィンドウ無しでも常に届く場所に置く。
 */
const iconFor = (recording: boolean): NativeImage => {
  const choice = trayIconFor(recording)
  // 32x32 を scaleFactor 2 として渡すと、16pt のアイコンとして扱われ Retina で滲まない。
  const icon = nativeImage.createFromBuffer(Buffer.from(choice.pngBase64, 'base64'), {
    width: 32,
    height: 32,
    scaleFactor: 2
  })
  // 待機中はテンプレート画像にしてライト／ダークに自動で色を合わせ、録音中は赤をそのまま見せる。
  icon.setTemplateImage(choice.template)
  return icon
}

export const createTray = (controller: TransportController, showWindow: () => void): Tray => {
  const icons = { idle: iconFor(false), recording: iconFor(true) }

  const tray = new Tray(icons.idle)
  tray.setToolTip('Duoscribe')

  const refresh = (): void => {
    const state = controller.state()

    tray.setImage(state.active ? icons.recording : icons.idle)

    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: state.active ? `録音中: ${state.title ?? ''}` : '停止中',
          enabled: false
        },
        { type: 'separator' },
        {
          label: state.active ? '録音を停止' : '録音を開始',
          // 表示は録音状態の変化（onStateChanged）で追従するので、ここで更新しない。
          click: () => controller.request(state.active ? 'stop' : 'start')
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
