import { type BundledBinaryParams, resolveBundledBinary } from '@infrastructure/system/resolveBundledBinary'

/**
 * 同梱した syscapture.exe（Windows のシステム音声の取り込み）の場所を解決する。
 *
 * micwatch と同じく scripts が resources/bin へ生成する成果物で、配布版では electron-builder が
 * Resources/bin へ入れる。開発時はリポジトリ直下の resources/bin を見る（`npm run build:syscapture`）。
 *
 * 見つからなければ undefined。相手の声が録れないことを録音の開始時に理由付きで伝え、
 * アプリの起動は止めない。
 */
export const resolveSysCaptureBinary = (params: BundledBinaryParams): string | undefined =>
  resolveBundledBinary('syscapture', params)
