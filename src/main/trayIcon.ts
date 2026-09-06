/**
 * メニューバー用の録音インジケータ（塗りつぶした円）。
 *
 * 32x32 の RGBA PNG を base64 で埋め込み、スケールファクタ 2 として扱うことで
 * Retina でも滲まない 16pt のアイコンになる。外部ファイルにするとパッケージ時の
 * パス解決が絡むため、埋め込みで完結させている。
 *
 * RGB は黒にしてテンプレート画像として扱わせるので、ライト／ダークの両方で
 * OS が自動的に色を合わせる。
 *
 * 中身が壊れていないことは tests/main/tray-icon.test.ts で検証している。
 * 以前ここに手で作った base64 を置いていたが、ヘッダだけ正しく画像データが
 * 壊れており、Electron 側では空の画像（0x0）になっていた。メニューバーに
 * 何も出ないという形でしか現れず気づきにくいため、テストで固定している。
 */
export const TRAY_ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAkUlEQVR42u2W0QnAIAxEHcFRHMFRMko2zSjWj/SntJTq2UTIwfsR4U5MNCmFQpuqdKjDCunaUmU1k057QHRPRpvXF+O7IBVlTh+MrxDi5G2SOnPnAgggozXBAPMTHgkgwAAy0ucNTPmr8iEdwQsC8FYBzK/AvAjN29DFQ2T+FJt/Ri6+YxcDiYuRzMVQGgot0QHghVlEEiDNbAAAAABJRU5ErkJggg=='
