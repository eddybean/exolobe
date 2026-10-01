import { type BundledBinaryParams, resolveBundledBinary } from '@infrastructure/system/resolveBundledBinary'

/**
 * 同梱した audioconv.exe（Windows の録音の保存と音声の取り込み）の場所を解決する。
 *
 * syscapture と同じく scripts が resources/bin へ生成する成果物で、配布版では electron-builder が
 * Resources/bin へ入れる。開発時はリポジトリ直下の resources/bin を見る（`npm run build:audioconv`）。
 *
 * 見つからなければ undefined。保存・取り込みのときに理由付きで失敗させ、アプリの起動は止めない。
 */
export const resolveAudioConvBinary = (params: BundledBinaryParams): string | undefined =>
  resolveBundledBinary('audioconv', params)
