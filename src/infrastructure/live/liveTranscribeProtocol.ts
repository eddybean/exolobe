import type { LiveTranscriptionEvent, LiveTranscriptionFailure } from '@application/ports'
import type { CaptionTrack, LiveCaptionAvailability, LiveCaptionStatus } from '@domain/LiveCaption'

/** livetranscribe とのやり取りの形（native/livetranscribe/main.swift の先頭のコメントと揃える）。 */

const TRACKS: readonly CaptionTrack[] = ['remote', 'self']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseJson = (line: string): Record<string, unknown> | undefined => {
  try {
    const value: unknown = JSON.parse(line)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** stdout の 1 行を読む。読めない行は読み飛ばす（新しい版が足した種類で止まらない）。 */
export const parseLiveTranscribeLine = (line: string): LiveTranscriptionEvent | undefined => {
  const value = parseJson(line.trim())
  if (!value) return undefined
  if (value.type === 'ready') return { type: 'ready' }
  if (value.type === 'downloading') return { type: 'downloading' }
  if (value.type !== 'caption') return undefined

  const track = typeof value.track === 'number' ? TRACKS[value.track] : undefined
  const { kind, text, startMs, endMs } = value
  if (
    track === undefined ||
    (kind !== 'volatile' && kind !== 'final') ||
    typeof text !== 'string' ||
    typeof startMs !== 'number' ||
    typeof endMs !== 'number'
  ) {
    return undefined
  }
  return { type: 'caption', caption: { track, kind, text, startMs, endMs } }
}

const REPORTED: readonly LiveCaptionAvailability[] = ['available', 'unsupported-os', 'unsupported-locale']

export const parseLiveTranscribeStatus = (stdout: string): LiveCaptionStatus => {
  const value = parseJson(stdout.trim().split('\n')[0] ?? '')
  const availability = REPORTED.find((known) => known === value?.availability)
  if (availability === undefined) return { availability: 'unavailable' }
  if (availability !== 'available') return { availability }
  return {
    availability,
    assets: value?.assets === 'installed' ? 'installed' : 'downloadable'
  }
}

/** stdin の枠: [track 1B][長さ 4B LE][16bit LE の PCM]。 */
export const frameOf = (track: CaptionTrack, pcm: Uint8Array): Buffer => {
  const header = Buffer.alloc(5)
  header.writeUInt8(TRACKS.indexOf(track), 0)
  header.writeUInt32LE(pcm.length, 1)
  return Buffer.concat([header, pcm])
}

/** 終了コード: 2 OS が非対応 / 3 言語が非対応 / それ以外は落ちた。 */
export const failureOfExit = (code: number | null): LiveTranscriptionFailure =>
  code === 2 ? 'unsupported-os' : code === 3 ? 'unsupported-locale' : 'crashed'
