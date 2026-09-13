import type {
  AudioCapturePort,
  DualTrackSource,
  RecordingArtifactPort,
  RecordingRepositoryPort
} from '@application/ports'
import { finishRecording, type Recording } from '@domain/Recording'
import { RecordingNotFoundError, RecordingStateError } from '@domain/errors'

export interface StopRecordingDeps {
  readonly repository: RecordingRepositoryPort
  readonly capture: AudioCapturePort
  readonly artifacts: RecordingArtifactPort
}

export interface StopRecordingResult {
  readonly recording: Recording
  readonly tracks: DualTrackSource
}

/**
 * 録音を停止し、後段のパイプラインが必要とするトラック情報を返す。
 * 実際の文字起こし・要約は ProcessRecording が別プロセスで担当する。
 */
export class StopRecording {
  constructor(private readonly deps: StopRecordingDeps) {}

  async execute(recordingId: string): Promise<StopRecordingResult> {
    if (!this.deps.capture.isActive()) {
      throw new RecordingStateError('録音中ではありません。')
    }

    const recording = await this.deps.repository.find(recordingId)
    if (!recording) {
      throw new RecordingNotFoundError(recordingId)
    }

    const tracks = await this.deps.capture.stop()
    const stopped = finishRecording(recording, tracks.durationMs)
    // アプリを再起動しても処理を再開できるよう、トラック情報をディスクに残す。
    await this.deps.artifacts.writeTracks(stopped, tracks)
    await this.deps.repository.save(stopped)

    return { recording: stopped, tracks }
  }
}
