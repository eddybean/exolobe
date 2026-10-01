import { type BundledBinaryParams, resolveBundledBinary } from '@infrastructure/system/resolveBundledBinary'

/**
 * 同梱した micwatch の場所を解決する。
 *
 * whisper-cli と同じく scripts が resources/bin へ生成する成果物で、配布版では
 * electron-builder が Resources/bin へ入れる。開発時はリポジトリ直下の
 * resources/bin を見る（`npm run setup` か `npm run build:micwatch` で作られる）。
 *
 * 見つからなければ undefined を返す。開始忘れの見張りが無効になるだけで、
 * 録音そのものは動く。ここで例外にすると、まだ作っていない開発環境で
 * アプリが起動しなくなる。
 */
export const resolveMicWatchBinary = (params: BundledBinaryParams): string | undefined =>
  resolveBundledBinary('micwatch', params)
