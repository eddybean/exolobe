import { Menu, app, shell, type MenuItemConstructorOptions } from 'electron'
import type { TransportController } from './ipc/handlers'
import { text } from './i18n'
import { toAppPlatform, type AppPlatform } from '@shared/platform'

/**
 * 先頭のメニュー。appMenu（アプリ名のメニュー）は macOS にしか無く、Windows では何も出ない。
 * Windows は終了の項目を持つファイルメニューにする（ADR-048）。
 */
export const leadingMenuRole = (platform: AppPlatform): 'appMenu' | 'fileMenu' =>
  platform === 'windows' ? 'fileMenu' : 'appMenu'

export interface MenuActions {
  readonly start: () => void
  readonly stop: () => void
  readonly showWindow: () => void
  readonly openDocs: () => void
}

type Role = NonNullable<MenuItemConstructorOptions['role']>
type WindowsLabels = ReturnType<typeof text>['windowsMenu']

/**
 * 役割の項目。Windows では Electron の既定の名前（英語）が出るので UI の言語の名前を付け、
 * macOS は OS の訳に任せて名前を付けない。
 */
const roleItem = (role: Role & keyof WindowsLabels, platform: AppPlatform): MenuItemConstructorOptions =>
  platform === 'windows' ? { role, label: text().windowsMenu[role] } : { role }

/**
 * Windows で役割の「メニュー」（fileMenu など）を使わずに組む中身。役割のメニューは中の項目まで
 * 英語の名前で作られるため、項目を並べて名前を付ける。
 */
const windowsSubmenu = (label: string, roles: readonly (Role & keyof WindowsLabels)[]): MenuItemConstructorOptions => ({
  label,
  submenu: roles.map((role) => roleItem(role, 'windows'))
})

/** メニューの中身。Electron に触らない純粋な関数にして、OS ごとの違いをテストで確かめる。 */
export const applicationMenuTemplate = (params: {
  platform: AppPlatform
  active: boolean
  actions: MenuActions
}): MenuItemConstructorOptions[] => {
  const { platform, active, actions } = params
  const windows = platform === 'windows'
  const w = text().windowsMenu

  return [
    windows ? windowsSubmenu(w.file, ['quit']) : { role: leadingMenuRole(platform) },
    {
      label: windows ? w.recording : text().menu.recording,
      submenu: [
        { label: text().menu.start, accelerator: 'CmdOrCtrl+R', enabled: !active, click: actions.start },
        { label: text().menu.stop, accelerator: 'CmdOrCtrl+.', enabled: active, click: actions.stop },
        { type: 'separator' },
        { label: text().menu.showWindow, accelerator: 'CmdOrCtrl+0', click: actions.showWindow }
      ]
    },
    windows ? windowsSubmenu(w.edit, ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) : { role: 'editMenu' },
    {
      label: windows ? w.view : text().menu.view,
      submenu: [
        roleItem('reload', platform),
        roleItem('toggleDevTools', platform),
        { type: 'separator' },
        roleItem('resetZoom', platform),
        roleItem('zoomIn', platform),
        roleItem('zoomOut', platform),
        { type: 'separator' },
        roleItem('togglefullscreen', platform)
      ]
    },
    windows ? windowsSubmenu(w.window, ['minimize', 'close']) : { role: 'windowMenu' },
    {
      role: 'help',
      ...(windows ? { label: w.help } : {}),
      submenu: [{ label: text().menu.openDocs, click: actions.openDocs }]
    }
  ]
}

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
export const createApplicationMenu = (controller: TransportController, showWindow: () => void): void => {
  const actions: MenuActions = {
    start: () => controller.request('start'),
    stop: () => controller.request('stop'),
    showWindow,
    openDocs: () => {
      void shell.openExternal('https://github.com/eddybean/exolobe/tree/main/docs')
    }
  }
  const build = (): Menu =>
    Menu.buildFromTemplate(
      applicationMenuTemplate({
        platform: toAppPlatform(process.platform),
        active: controller.state().active,
        actions
      })
    )

  Menu.setApplicationMenu(build())

  // 録音状態が変わったら項目の有効／無効を追従させる。
  app.on('browser-window-focus', () => Menu.setApplicationMenu(build()))
  controller.onStateChanged(() => Menu.setApplicationMenu(build()))
}
