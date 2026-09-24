import { join } from 'node:path'
import { BrowserWindow, app, globalShortcut, shell, type Tray } from 'electron'
import { createContainer } from './container'
import { registerIpcHandlers } from './ipc/handlers'
import { createApplicationMenu } from './menu'
import { createTray } from './tray'

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
      contextIsolation: true
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

const showWindow = (): void => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

void app.whenReady().then(() => {
  const container = createContainer()

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
