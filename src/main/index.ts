import { join } from 'node:path'
import { BrowserWindow, app, shell } from 'electron'
import { createContainer } from './container'
import { registerIpcHandlers } from './ipc/handlers'
import { createTray } from './tray'

/**
 * アプリのエントリポイント。
 *
 * 録音中にウィンドウを閉じても処理が続くよう、macOS では最後のウィンドウが
 * 閉じてもアプリを終了させない（メニューバーから停止できる）。
 */

let mainWindow: BrowserWindow | undefined

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
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
  const controller = registerIpcHandlers(container, () => mainWindow)
  createTray(controller, showWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) showWindow()
  })
})

app.on('window-all-closed', () => {
  // 録音とバックグラウンド処理を続けたいので、macOS の慣習どおり終了しない。
  if (process.platform !== 'darwin') app.quit()
})
