import { Menu, Tray, nativeImage, nativeTheme, type NativeImage } from 'electron'
import type { TransportController } from './ipc/handlers'
import { trayIconFor, whitenBitmap, type TrayAppearance } from './trayIcon'
import { text } from './i18n'
import { toAppPlatform } from '@shared/platform'

/**
 * メニューバーからの録音操作。
 *
 * 会議中はウィンドウを閉じている（あるいは他アプリの背後にある）ことが多いため、
 * 開始・停止だけはウィンドウ無しでも常に届く場所に置く。
 */
const iconFor = (recording: boolean, appearance: TrayAppearance): NativeImage => {
  const choice = trayIconFor(recording, appearance)
  // 32x32 を scaleFactor 2 として渡すと、16pt のアイコンとして扱われ Retina で滲まない。
  const size = { width: 32, height: 32, scaleFactor: 2 }
  const decoded = nativeImage.createFromBuffer(Buffer.from(choice.pngBase64, 'base64'), size)
  const icon = choice.whiten ? nativeImage.createFromBitmap(whitenBitmap(decoded.toBitmap()), size) : decoded
  // macOS の待機中はテンプレート画像にしてライト／ダークに自動で色を合わせ、録音中は赤をそのまま見せる。
  icon.setTemplateImage(choice.template)
  return icon
}

/** いまのタスクバー（メニューバー）の見た目。Windows のタスクバーはアプリの外観と別に明暗を持つ。 */
const currentAppearance = (): TrayAppearance => ({
  platform: toAppPlatform(process.platform),
  darkTaskbar: nativeTheme.shouldUseDarkColorsForSystemIntegratedUI
})

export const createTray = (controller: TransportController, showWindow: () => void): Tray => {
  const makeIcons = (): { idle: NativeImage; recording: NativeImage } => {
    const appearance = currentAppearance()
    return { idle: iconFor(false, appearance), recording: iconFor(true, appearance) }
  }
  let icons = makeIcons()

  const tray = new Tray(icons.idle)
  tray.setToolTip('Exolobe')
  // Windows ではトレイのアイコンを左クリックしたらウィンドウを出すのが慣例（右クリックはメニュー）。
  // macOS はクリックでメニューを出すのが慣例なので、そのままにする。
  if (process.platform === 'win32') tray.on('click', showWindow)

  const refresh = (): void => {
    const state = controller.state()

    tray.setImage(state.active ? icons.recording : icons.idle)

    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: state.active ? text().tray.recording(state.title ?? '') : text().tray.idle,
          enabled: false
        },
        { type: 'separator' },
        {
          label: state.active ? text().tray.stop : text().tray.start,
          // 表示は録音状態の変化（onStateChanged）で追従するので、ここで更新しない。
          click: () => controller.request(state.active ? 'stop' : 'start')
        },
        { label: text().tray.showWindow, click: showWindow },
        { type: 'separator' },
        { label: text().tray.quit, role: 'quit' }
      ])
    )
  }

  refresh()
  // タスクバーの明暗が変わったら、待機中のアイコンの色を合わせ直す（Windows）。
  nativeTheme.on('updated', () => {
    icons = makeIcons()
    refresh()
  })
  // 録音状態が変わったら表示を追従させる。クリック時だけの更新では、
  // ウィンドウ側で停止したときにトレイの表示が古いままになる。
  controller.onStateChanged(refresh)

  return tray
}
