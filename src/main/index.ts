import { join } from 'node:path'
import { BrowserWindow, app, globalShortcut, nativeTheme, shell, type Tray } from 'electron'
import { localeArg, resolveLocale } from '@shared/i18n/locale'
import { applyAppearance } from './appearance'
import { createContainer } from './container'
import { appLocale, setAppLocale } from './i18n'
import { registerIpcHandlers } from './ipc/handlers'
import { createApplicationMenu } from './menu'
import { createTray } from './tray'
import { claimSingleInstance } from './singleInstance'

/**
 * アプリのエントリポイント。
 *
 * 録音中にウィンドウを閉じても処理が続くよう、macOS では最後のウィンドウが
 * 閉じてもアプリを終了させない（メニューバーから停止できる）。
 */

let mainWindow: BrowserWindow | undefined

/**
 * Tray は参照を保持し続けないと GC で回収され、メニューバーからアイコンが消える。
 * Electron でよくある落とし穴で、実際にこれで表示されなくなっていた。
 */
// oxlint-disable-next-line no-unused-vars -- 参照を保持することが目的の変数
let tray: Tray | undefined

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    // Electron 44 のウィンドウ状態永続化。name をキーに位置とサイズが保存され、
    // ディスプレイ構成が変わったときの画面外補正も Electron 側が面倒を見る。
    // displayMode は復元しない — 前回フルスクリーンだからと次回もフルスクリーンで
    // 起動されると、録音を始めたいだけのときに邪魔になるため。
    name: 'main',
    windowStatePersistence: { bounds: true, displayMode: false },
    // 保存された状態がないとき（初回起動）にだけ使われる既定値。
    width: 1_180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      additionalArguments: [localeArg(appLocale())]
    }
  })

  window.on('ready-to-show', () => window.show())

  // 外部リンクは既定のブラウザで開き、アプリ内を乗っ取らせない。
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

/**
 * UI の言語を決める優先言語（ADR-043）。
 *
 * OMR_LOCALE は OS の設定を変えずに別の言語の画面を確かめるための開発用。先頭に置くだけなので、
 * 対応していない値なら OS の優先言語に戻る。
 */
const preferredLanguages = (): string[] => {
  const override = process.env['OMR_LOCALE']
  const system = app.getPreferredSystemLanguages()
  return override ? [override, ...system] : system
}

const showWindow = (): void => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

// 2 つ目の起動では何も始めない。コンテナを作るだけでワーカーや監視が動き出すため、判定は最初に行う。
if (claimSingleInstance(app, showWindow)) {
  void app.whenReady().then(async () => {
    setAppLocale(resolveLocale(preferredLanguages()))
    const container = createContainer()

    // ウィンドウより先に明暗を決める。後から切り替えると一瞬 OS 側の明暗で描かれる。
    applyAppearance(nativeTheme, await container.settings.load())
    mainWindow = createWindow()
    const controller = registerIpcHandlers(container, () => mainWindow, showWindow)

    // どちらも「ウィンドウを見ていなくても録音を止められる」ための導線。
    tray = createTray(controller, showWindow)
    createApplicationMenu(controller, showWindow)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) showWindow()
    })
  })

  // 登録したショートカットは終了時に外す（Electron が求める後始末）。
  app.on('will-quit', () => globalShortcut.unregisterAll())

  app.on('window-all-closed', () => {
    // 録音とバックグラウンド処理を続けたいので、macOS の慣習どおり終了しない。
    if (process.platform !== 'darwin') app.quit()
  })
}
