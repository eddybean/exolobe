import { type BundledBinaryParams, resolveBundledBinary } from '@infrastructure/system/resolveBundledBinary'

/**
 * 同梱した calendarevents の場所を解決する。置き方は micwatch と同じ
 * （scripts/build-calendarevents.sh が resources/bin へ生成し、配布版では Resources/bin に入る）。
 *
 * 見つからなければ undefined を返す。カレンダー連携が無効になるだけで、
 * 録音そのものは動く。
 */
export const resolveCalendarBinary = (params: BundledBinaryParams): string | undefined =>
  resolveBundledBinary('calendarevents', params)
