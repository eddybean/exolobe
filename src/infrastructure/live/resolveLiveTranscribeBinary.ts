import { type BundledBinaryParams, resolveBundledBinary } from '@infrastructure/system/resolveBundledBinary'

/**
 * 録音中のライブ字幕に使う livetranscribe（ADR-050）。無ければ録音中のアシストを出さないだけで、
 * 録音は動く（Windows には無い）。
 */
export const resolveLiveTranscribeBinary = (params: BundledBinaryParams): string | undefined =>
  resolveBundledBinary('livetranscribe', params)
