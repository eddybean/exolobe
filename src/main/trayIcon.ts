import type { AppPlatform } from '@shared/platform'

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
  /** 白く塗ってから使う（whitenBitmap）。 */
  readonly whiten: boolean
}

/** アイコンを置く場所の見た目。Windows はタスクバー、macOS はメニューバー。 */
export interface TrayAppearance {
  readonly platform: AppPlatform
  /** タスクバーがダークか。macOS は OS が塗り直すので見ない。 */
  readonly darkTaskbar: boolean
}

/**
 * 待機中と録音中で使う画像。
 *
 * macOS の待機中はテンプレート画像にして OS に明暗を合わせさせる。Windows は setTemplateImage が効かず、
 * 黒いままだとダークのタスクバーで見えなくなるので、タスクバーの明暗に合わせて待機中だけ白く塗る（ADR-048）。
 * 録音中は、どちらでも赤をそのまま見せる。
 */
export const trayIconFor = (recording: boolean, appearance: TrayAppearance): TrayIconChoice => {
  if (recording) return { pngBase64: TRAY_ICON_RECORDING_PNG_BASE64, template: false, whiten: false }
  if (appearance.platform === 'macos') return { pngBase64: TRAY_ICON_PNG_BASE64, template: true, whiten: false }
  return { pngBase64: TRAY_ICON_PNG_BASE64, template: false, whiten: appearance.darkTaskbar }
}

/**
 * 4 バイト 1 画素（BGRA）の画像を、形（透明度）を保ったまま白く塗る。
 * 色は透明度と同じ値にする。nativeImage の画素が透明度を乗算済みでも、乗算前でも白く見える
 * （乗算前なら縁がわずかに暗くなるだけで、ダークのタスクバーでは目立たない）。
 */
export const whitenBitmap = (bitmap: Buffer): Buffer => {
  const out = Buffer.from(bitmap)
  for (let i = 0; i + 3 < out.length; i += 4) {
    const alpha = out[i + 3] ?? 0
    out[i] = alpha
    out[i + 1] = alpha
    out[i + 2] = alpha
  }
  return out
}
