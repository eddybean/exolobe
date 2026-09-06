import { open, readFile, type FileHandle } from 'node:fs/promises'
import { AppError } from '@domain/errors'

/**
 * 16bit PCM の WAV 入出力。
 *
 * 録音中のデータをメモリに溜めるとクラッシュで全損するため、書き込みは常に
 * ストリーミングで行い、サイズが確定するヘッダは close 時に上書きする。
 */

const HEADER_BYTES = 44
const BYTES_PER_SAMPLE = 2

export interface WavFormat {
  readonly sampleRate: number
  readonly channels: number
  readonly bitsPerSample: number
}

export class WavFormatError extends AppError {}

/** 数値配列を 16bit リトルエンディアンの PCM バッファへ変換する（テストと合成用）。 */
export const int16Buffer = (samples: readonly number[]): Buffer => {
  const buffer = Buffer.allocUnsafe(samples.length * BYTES_PER_SAMPLE)
  samples.forEach((sample, index) => {
    buffer.writeInt16LE(clampInt16(sample), index * BYTES_PER_SAMPLE)
  })
  return buffer
}

export const clampInt16 = (value: number): number => Math.max(-32_768, Math.min(32_767, value))

export const durationMsForPcm = (sampleCount: number, sampleRate: number): number =>
  Math.round((sampleCount / sampleRate) * 1000)

const buildHeader = (format: WavFormat, dataBytes: number): Buffer => {
  const header = Buffer.alloc(HEADER_BYTES)
  const byteRate = (format.sampleRate * format.channels * format.bitsPerSample) / 8
  const blockAlign = (format.channels * format.bitsPerSample) / 8

  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(HEADER_BYTES - 8 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // fmt チャンクのサイズ（PCM は 16）
  header.writeUInt16LE(1, 20) // オーディオフォーマット: 1 = リニア PCM
  header.writeUInt16LE(format.channels, 22)
  header.writeUInt32LE(format.sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(format.bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)

  return header
}

/** WAV を逐次書き出す。close するまでヘッダのサイズ欄は 0 のまま。 */
export class WavFileWriter {
  private dataBytes = 0
  private closed = false

  private constructor(
    private readonly handle: FileHandle,
    private readonly format: WavFormat
  ) {}

  static async create(
    path: string,
    options: { sampleRate: number; channels?: number; bitsPerSample?: number }
  ): Promise<WavFileWriter> {
    const format: WavFormat = {
      sampleRate: options.sampleRate,
      channels: options.channels ?? 1,
      bitsPerSample: options.bitsPerSample ?? 16
    }

    const handle = await open(path, 'w')
    await handle.write(buildHeader(format, 0), 0, HEADER_BYTES, 0)

    return new WavFileWriter(handle, format)
  }

  async write(chunk: Buffer): Promise<void> {
    if (this.closed) throw new WavFormatError('クローズ済みの WAV には書き込めません。')
    if (chunk.length === 0) return

    await this.handle.write(chunk, 0, chunk.length, HEADER_BYTES + this.dataBytes)
    this.dataBytes += chunk.length
  }

  get durationMs(): number {
    const sampleCount = this.dataBytes / (BYTES_PER_SAMPLE * this.format.channels)
    return durationMsForPcm(sampleCount, this.format.sampleRate)
  }

  /** サイズ欄を確定させてファイルを閉じる。 */
  async close(): Promise<{ bytesWritten: number; durationMs: number }> {
    if (this.closed) return { bytesWritten: this.dataBytes, durationMs: this.durationMs }
    this.closed = true

    const result = { bytesWritten: this.dataBytes, durationMs: this.durationMs }
    await this.handle.write(buildHeader(this.format, this.dataBytes), 0, HEADER_BYTES, 0)
    await this.handle.close()

    return result
  }
}

export interface WavData extends WavFormat {
  readonly samples: Int16Array
}

/**
 * WAV を全読みして 16bit サンプル列を返す。
 * 会議 1 時間でも 16kHz mono なら約 115MB で、ミックス処理には十分収まる。
 */
export const readWav = async (path: string): Promise<WavData> => {
  const raw = await readFile(path)

  if (raw.length < HEADER_BYTES || raw.toString('ascii', 0, 4) !== 'RIFF') {
    throw new WavFormatError(`WAV ファイルとして読み取れません: ${path}`)
  }
  if (raw.toString('ascii', 8, 12) !== 'WAVE') {
    throw new WavFormatError(`WAV ファイルとして読み取れません: ${path}`)
  }

  const bitsPerSample = raw.readUInt16LE(34)
  if (bitsPerSample !== 16) {
    throw new WavFormatError(`16bit PCM のみ対応しています（${bitsPerSample}bit）: ${path}`)
  }

  const { offset, size } = findDataChunk(raw, path)
  // ヘッダのサイズ欄が実ファイルより大きいことがあるため、実体側に合わせる。
  const dataBytes = Math.min(size, raw.length - offset)
  const sampleCount = Math.floor(dataBytes / BYTES_PER_SAMPLE)

  const samples = new Int16Array(sampleCount)
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = raw.readInt16LE(offset + index * BYTES_PER_SAMPLE)
  }

  return {
    sampleRate: raw.readUInt32LE(24),
    channels: raw.readUInt16LE(22),
    bitsPerSample,
    samples
  }
}

/** data チャンクは LIST 等の後ろに来ることがあるため位置を走査する。 */
const findDataChunk = (raw: Buffer, path: string): { offset: number; size: number } => {
  let cursor = 12
  while (cursor + 8 <= raw.length) {
    const id = raw.toString('ascii', cursor, cursor + 4)
    const size = raw.readUInt32LE(cursor + 4)
    if (id === 'data') return { offset: cursor + 8, size }
    // チャンクは 2 バイト境界に揃う。
    cursor += 8 + size + (size % 2)
  }

  throw new WavFormatError(`data チャンクが見つかりません: ${path}`)
}
