import { Menu, app, shell, type MenuItemConstructorOptions } from 'electron'
import type { TransportController } from './ipc/handlers'
import { text } from './i18n'

/**
 * アプリケーションメニュー。
 *
 * 既定のメニューには録音の操作が無く、ウィンドウを前面に出さないと停止できなかった。
 * メニューバーのアイコン（Tray）と併せて、ウィンドウを見ていなくても録音を
 * 止められる導線をもう 1 本用意する。
 *
 * メニューは開かれるたびに作り直す。録音中かどうかで項目の有効／無効が変わり、
 * 状態の変化を個別に監視するより、その都度組み立てた方が確実にずれない。
 */
export const createApplicationMenu = (
  controller: TransportController,
  showWindow: () => void
): void => {
  const build = (): Menu => {
    const active = controller.state().active

    const template: MenuItemConstructorOptions[] = [
      { role: 'appMenu' },
      {
        label: text().menu.recording,
        submenu: [
          {
            label: text().menu.start,
            accelerator: 'CmdOrCtrl+R',
            enabled: !active,
            click: () => controller.request('start')
          },
          {
            label: text().menu.stop,
            accelerator: 'CmdOrCtrl+.',
            enabled: active,
            click: () => controller.request('stop')
          },
          { type: 'separator' },
          { label: text().menu.showWindow, accelerator: 'CmdOrCtrl+0', click: showWindow }
        ]
      },
      { role: 'editMenu' },
      {
        label: text().menu.view,
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [
          {
            label: text().menu.openDocs,
            click: () => {
              void shell.openExternal(
                'https://github.com/eddybean/exolobe/tree/main/docs'
              )
            }
          }
        ]
      }
    ]

    return Menu.buildFromTemplate(template)
  }

  Menu.setApplicationMenu(build())

  // 録音状態が変わったら項目の有効／無効を追従させる。
  app.on('browser-window-focus', () => Menu.setApplicationMenu(build()))
  controller.onStateChanged(() => Menu.setApplicationMenu(build()))
}
