import type { AudioDecoderPort, AudioEncoderPort } from '@application/ports'
import { AFCONVERT_IMPORT_FORMATS, type ImportFormats, MEDIA_FOUNDATION_IMPORT_FORMATS } from '@domain/AudioImport'
import { AfconvertDecoder } from '@infrastructure/audio/AfconvertDecoder'
import { AfconvertEncoder } from '@infrastructure/audio/AfconvertEncoder'
import { MediaFoundationDecoder } from '@infrastructure/audio/MediaFoundationDecoder'
import { MediaFoundationEncoder } from '@infrastructure/audio/MediaFoundationEncoder'

export interface AudioConverters {
  readonly encoder: AudioEncoderPort
  readonly decoder: AudioDecoderPort
  /** decoder が読める形式。取り込みの判定とファイル選択のフィルタに使う。 */
  readonly importFormats: ImportFormats
}

/**
 * OS の変換器を選ぶ（ADR-048）。macOS は afconvert、Windows は Media Foundation（audioconv.exe）。
 *
 * 読める形式は変換器で決まるので、デコーダと取り込める一覧は必ず組で選ぶ。main の container と
 * パイプラインのワーカーの container の両方から呼ぶので、`electron` を import しない。
 */
export const audioConvertersFor = (platform: NodeJS.Platform, audioconvPath: string | undefined): AudioConverters =>
  platform === 'win32'
    ? {
        encoder: new MediaFoundationEncoder(audioconvPath),
        decoder: new MediaFoundationDecoder(audioconvPath),
        importFormats: MEDIA_FOUNDATION_IMPORT_FORMATS
      }
    : { encoder: new AfconvertEncoder(), decoder: new AfconvertDecoder(), importFormats: AFCONVERT_IMPORT_FORMATS }
