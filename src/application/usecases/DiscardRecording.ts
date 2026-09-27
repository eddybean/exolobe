import type {
  AudioCapturePort,
  RecordingArtifactPort,
  RecordingRepositoryPort
} from '@application/ports'
import { RecordingNotFoundError, RecordingStateError } from '@domain/errors'

export interface DiscardRecordingDeps {
  readonly repository: RecordingRepositoryPort
  readonly capture: AudioCapturePort
  readonly artifacts: RecordingArtifactPort
}

/**
 * 録音を止め、何も残さずに消す（ADR-041 の「停止して破棄」）。
 *
 * 自動で始まった録音が録ってはいけない会議だったときのための操作。停止してから
 * 削除する 2 手に分けると、その間にパイプラインが走り出し、処理中の録音を消すことになる
 * （処理側が状態を書き戻して、消したはずの録音が一覧に戻りうる）。トラック情報も書かないので、
 * 再起動後に処理が再開されることもない。
 */
export class DiscardRecording {
  constructor(private readonly deps: DiscardRecordingDeps) {}

  async execute(recordingId: string): Promise<void> {
    if (!this.deps.capture.isActive()) {
      throw new RecordingStateError('録音中ではありません。')
    }

    const recording = await this.deps.repository.find(recordingId)
    if (!recording) {
      throw new RecordingNotFoundError(recordingId)
    }

    await this.deps.capture.stop()
    await this.deps.artifacts.removeAll(recording)
    await this.deps.repository.remove(recordingId)
  }
}
