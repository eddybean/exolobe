import { type BundledBinaryParams, resolveBundledBinary } from '@infrastructure/system/resolveBundledBinary'

/**
 * 同梱した applelm の場所を解決する（ADR-046）。
 *
 * micwatch と同じく scripts が resources/bin へ生成する成果物で、配布版では
 * electron-builder が Resources/bin へ入れる。開発時はリポジトリ直下の
 * resources/bin を見る（`npm run setup` か `npm run build:applelm` で作られる）。
 *
 * 見つからなければ undefined を返す。Apple Intelligence を選べなくなるだけで、
 * Gemma での要約は動く。
 */
export const resolveAppleLmBinary = (params: BundledBinaryParams): string | undefined =>
  resolveBundledBinary('applelm', params)
