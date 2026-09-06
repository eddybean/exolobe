import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AudioCapturePort, CapturedTracks } from '@application/ports'
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

  isActive(): boolean {
    return this.state !== undefined
  }

  async start(params: { workDir: string; sampleRate: number }): Promise<void> {
    if (this.state) throw new CaptureError('すでに録音中です。')

    await mkdir(params.workDir, { recursive: true })
    const system = await WavFileWriter.create(join(params.workDir, 'system.wav'), {
      sampleRate: params.sampleRate
    })
    const mic = await WavFileWriter.create(join(params.workDir, 'mic.wav'), {
      sampleRate: params.sampleRate
    })

    this.state = { workDir: params.workDir, system, mic, writes: Promise.resolve() }

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

  /** レンダラーの AudioWorklet から届いた 16bit PCM を書き足す。 */
  async pushMicPcm(pcm: Buffer): Promise<void> {
    const state = this.state
    if (!state || pcm.length === 0) return

    state.micFirstChunkAt ??= this.now()
    this.enqueue(state, () => state.mic.write(pcm))
    await state.writes
  }

  private appendSystemPcm(pcm: Buffer): void {
    const state = this.state
    if (!state || pcm.length === 0) return

    state.systemFirstChunkAt ??= this.now()
    this.enqueue(state, () => state.system.write(pcm))
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

  async stop(): Promise<CapturedTracks> {
    const state = this.state
    if (!state) throw new CaptureError('録音中ではありません。')

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
