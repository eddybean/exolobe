/** テストで偽物に差し替えられるよう、electron の app から使う部分だけを切り出した形。 */
export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean
  quit(): void
  isReady(): boolean
  on(event: 'second-instance', listener: () => void): void
}

/**
 * アプリを 1 つだけ動かす。続行してよければ true を返す。
 *
 * 2 つ目が動くと、同じ index.json や再生成できない voiceprints.json に 2 つのプロセスが
 * 並行して書き、録音も二重になる。後から起動した側は何も始めずに終わり、
 * 先にいる側のウィンドウを前に出す（Dock やメニューバーから見失ったときの再起動を想定）。
 *
 * ロックは userData ごとに取られるので、`--user-data-dir` で隔離した確認用の起動とは衝突しない。
 */
export const claimSingleInstance = (app: SingleInstanceApp, showWindow: () => void): boolean => {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }
  app.on('second-instance', () => {
    // ready 前に BrowserWindow を作ると例外になる。その場合は ready 後に最初のウィンドウが開く。
    if (app.isReady()) showWindow()
  })
  return true
}
