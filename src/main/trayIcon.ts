/**
 * メニューバー用のアイコン。アプリアイコンと同じ「二本の軌跡」で、
 * 中心線の上下に波形を分けて置く（上＝相手、下＝自分）。
 * `scripts/build-icon.mjs` がアプリアイコンと同じ寸法定義から出力する
 * 32x32 を、下の base64 に貼っている。意匠を変えるときは両方を同時に作り直す。
 *
 * 32x32 の RGBA PNG を base64 で埋め込み、スケールファクタ 2 として扱うことで
 * Retina でも滲まない 16pt のアイコンになる。外部ファイルにするとパッケージ時の
 * パス解決が絡むため、埋め込みで完結させている。
 *
 * 待機中は RGB を黒にしてテンプレート画像として扱わせるので、ライト／ダークの両方で
 * OS が自動的に色を合わせる。録音中は同じ形を赤で塗った画像に切り替える。
 * 会議中はウィンドウを見ていないことが多く、メニューバーだけで録音しているかを
 * 見分けられないと、録り忘れや止め忘れに気づけないため。
 *
 * 中身が壊れていないことは tests/main/tray-icon.test.ts で検証している。
 * 以前ここに手で作った base64 を置いていたが、ヘッダだけ正しく画像データが
 * 壊れており、Electron 側では空の画像（0x0）になっていた。メニューバーに
 * 何も出ないという形でしか現れず気づきにくいため、テストで固定している。
 */
export const TRAY_ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAATUlEQVR42mNgGAXUAf+R8PByALEGjzpgUDqAZEdRYsjIcgAlYgPuALyOGnXAgDtgFIymgVEHjIiimGY5g2aNlFEHDOl24vDtBY0CqgIA/0kb8wSBkckAAAAASUVORK5CYII='

/** 録音中のアイコン。待機中と同じ形を macOS の systemRed で塗ったもの。 */
export const TRAY_ICON_RECORDING_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAUElEQVR42mNgGAVUAP+tDf7D8PByALEGjzpgUDqAZEdRYsjIcgAlYgPuALyOGnXAgDtgFIymgVEHjIiimGY5g2aNlFEHDOl24vDtBY0CagMAw/yvBAtjts0AAAAASUVORK5CYII='

export interface TrayIconChoice {
  readonly pngBase64: string
  /** テンプレート画像にすると OS が単色に塗り直すため、色を見せたいときは外す。 */
  readonly template: boolean
}

export const trayIconFor = (recording: boolean): TrayIconChoice =>
  recording
    ? { pngBase64: TRAY_ICON_RECORDING_PNG_BASE64, template: false }
    : { pngBase64: TRAY_ICON_PNG_BASE64, template: true }
