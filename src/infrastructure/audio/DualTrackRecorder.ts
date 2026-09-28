import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AudioCapturePort, DualTrackSource } from '@application/ports'
import { AppError } from '@domain/errors'
import { WavFileWriter } from './wav'

export class CaptureError extends AppError {}

/**
 * システム音声の供給元。実体は Core Audio Process Tap（audiotee）だが、
 * ここを差し替えられるようにすることで録音の調整ロジックを I/O なしで検証できる。
 */
export interface SystemAudioSource {
  start(params: { sampleRate: number }): Promise<void>
  stop(): Promise<void>
  onData(listener: (pcm: Buffer) => void): void
  onError(listener: (error: Error) => void): void
}

/** 単調増加する時刻。トラック間のオフセット算出に使う。 */
export type MonotonicClock = () => number

interface CaptureState {
  readonly workDir: string
  readonly system: WavFileWriter
  readonly mic: WavFileWriter
  /**
   * 書き込みを直列化するためのプロミス鎖。システム音声はイベントコールバックで
   * 届き呼び出し元が await できないため、これが無いと停止時に未完了の書き込みが
   * 取りこぼされ、音声が欠落する。
   */
  writes: Promise<void>
  /**
   * UI が最後に読み出して以降に届いたシステム音声の peak。
   * 表示のためだけの値なので、書き込みの成否とは無関係に保つ。
   */
  systemPeak: number
  systemFirstChunkAt?: number
  micFirstChunkAt?: number
  error?: Error
}

/**
 * マイクとシステム音声を別々の WAV に同時録音する。
 *
 * 2 つのトラックを分けたまま保持するのが設計の要。相手（システム音声）と自分
 * （マイク）が最初から分離されるため、後段の話者識別は推論なしで 2 話者を確定でき、
 * 文字起こしもクロストークの影響を受けない。
 *
 * マイク PCM はレンダラーの AudioWorklet から IPC で届くため、レコーダーは
 * `pushMicPcm` で受け取る受動的な口を持つ。
 */
export class DualTrackRecorder implements AudioCapturePort {
  private state: CaptureState | undefined

  /**
   * 届いた PCM の peak を知らせる先。UI のメーター（systemLevel）は読み出しで値を
   * 消費するため、無音の見張りのような別の消費者と同じ口を使うと互いの値を
   * 奪い合う。購読なら誰が何人いても影響しない。
   */
  private readonly peakListeners: ((peak: number) => void)[] = []

  constructor(
    private readonly source: SystemAudioSource,
    private readonly now: MonotonicClock = () => performance.now()
  ) {
    this.source.onData((pcm) => {
      this.appendSystemPcm(pcm)
    })
    this.source.onError((error) => {
      if (this.state) this.state.error = error
    })
  }

  onPeak(listener: (peak: number) => void): void {
    this.peakListeners.push(listener)
  }

  isActive(): boolean {
    return this.state !== undefined
  }

  async start(params: { workDir: string; sampleRate: number }): Promise<void> {
    if (this.state) throw new CaptureError({ code: 'alreadyRecording' })

    await mkdir(params.workDir, { recursive: true })
    const system = await WavFileWriter.create(join(params.workDir, 'system.wav'), {
      sampleRate: params.sampleRate
    })
    const mic = await WavFileWriter.create(join(params.workDir, 'mic.wav'), {
      sampleRate: params.sampleRate
    })

    this.state = {
      workDir: params.workDir,
      system,
      mic,
      writes: Promise.resolve(),
      systemPeak: 0
    }

    try {
      await this.source.start({ sampleRate: params.sampleRate })
    } catch (error: unknown) {
      // 開始に失敗したら中途半端な WAV を残さず、状態も巻き戻す。
      await system.close()
      await mic.close()
      this.state = undefined
      throw error
    }
  }

  /**
   * 前回の読み出し以降に届いたシステム音声の peak を返し、その値を捨てる。
   *
   * 保持し続けると音が止まってもメーターが下がらないため、読み出しでリセットする。
   * 読み出す側（UI）が一定間隔で呼ぶ前提で、その間隔ぶんの最大値になる。
   */
  systemLevel(): number {
    const state = this.state
    if (!state) return 0

    const peak = state.systemPeak
    state.systemPeak = 0
    return peak
  }

  /** レンダラーの AudioWorklet から届いた 16bit PCM を書き足す。 */
  async pushMicPcm(pcm: Buffer): Promise<void> {
    const state = this.state
    if (!state || pcm.length === 0) return

    state.micFirstChunkAt ??= this.now()
    this.notifyPeak(peakOf(pcm))
    this.enqueue(state, () => state.mic.write(pcm))
    await state.writes
  }

  private appendSystemPcm(pcm: Buffer): void {
    const state = this.state
    if (!state || pcm.length === 0) return

    state.systemFirstChunkAt ??= this.now()
    const peak = peakOf(pcm)
    state.systemPeak = Math.max(state.systemPeak, peak)
    this.notifyPeak(peak)
    this.enqueue(state, () => state.system.write(pcm))
  }

  private notifyPeak(peak: number): void {
    for (const listener of this.peakListeners) listener(peak)
  }

  /**
   * 書き込みを直列に積む。1 つが失敗しても鎖を切らず、原因は state.error に残して
   * 停止時に判断する（一時的なエラーで録音全体を失わせない）。
   */
  private enqueue(state: CaptureState, write: () => Promise<void>): void {
    state.writes = state.writes.then(write).catch((error: unknown) => {
      state.error ??= error instanceof Error ? error : new Error(String(error))
    })
  }

  async stop(): Promise<DualTrackSource> {
    const state = this.state
    if (!state) throw new CaptureError({ code: 'notRecording' })

    // 以降に届く PCM を無視するため、先に状態を落としてから片付ける。
    this.state = undefined

    await this.source.stop()
    // 積まれた書き込みを取りこぼさないよう、閉じる前に必ず流し切る。
    await state.writes
    const system = await state.system.close()
    const mic = await state.mic.close()

    if (state.error && system.bytesWritten === 0) {
      throw state.error
    }

    return {
      kind: 'dual',
      systemWavPath: join(state.workDir, 'system.wav'),
      micWavPath: join(state.workDir, 'mic.wav'),
      micOffsetMs: this.micOffsetMs(state),
      durationMs: Math.max(system.durationMs, mic.durationMs)
    }
  }

  /**
   * 2 トラックの録音開始時刻の差。最初の PCM が届いた時刻を基準にする。
   * どちらかが無音のまま終わった場合はずらす根拠が無いので 0 とする。
   */
  private micOffsetMs(state: CaptureState): number {
    const { systemFirstChunkAt, micFirstChunkAt } = state
    if (systemFirstChunkAt === undefined || micFirstChunkAt === undefined) return 0
    return Math.round(micFirstChunkAt - systemFirstChunkAt)
  }
}

/**
 * 16bit PCM の振幅の最大値を 0〜1 で表す。
 * 実効値（RMS）ではなく peak なのは、短い発話でもメーターが振れる方が
 * 「音が録れているか」の確認に向くため。
 */
export const peakOf = (pcm: Buffer): number => {
  let max = 0
  for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
    const magnitude = Math.abs(pcm.readInt16LE(offset))
    if (magnitude > max) max = magnitude
  }
  return max / 32_768
}
