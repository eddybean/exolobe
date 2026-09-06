import type {
  AudioCapturePort,
  ClockPort,
  IdGeneratorPort,
  RecordingArtifactPort,
  RecordingRepositoryPort,
  SettingsRepositoryPort
} from '@application/ports'
import { createRecording, type Recording } from '@domain/Recording'
import { ConfigurationError, RecordingStateError } from '@domain/errors'
import { isConfigured } from '@domain/Settings'

export interface StartRecordingDeps {
  readonly settings: SettingsRepositoryPort
  readonly repository: RecordingRepositoryPort
  readonly capture: AudioCapturePort
  readonly artifacts: RecordingArtifactPort
  readonly clock: ClockPort
  readonly ids: IdGeneratorPort
}

/** 録音を開始する。保存先が未設定、または録音中の場合は失敗する。 */
export class StartRecording {
  constructor(private readonly deps: StartRecordingDeps) {}

  async execute(params: { title?: string }): Promise<Recording> {
    if (this.deps.capture.isActive()) {
      throw new RecordingStateError('すでに録音中です。')
    }

    const settings = await this.deps.settings.load()
    if (!isConfigured(settings)) {
      throw new ConfigurationError(
        '保存先が設定されていません。設定画面から保存先を選んでください。'
      )
    }

    const recording = createRecording({
      id: this.deps.ids.next(),
      startedAt: this.deps.clock.now(),
      ...(params.title === undefined ? {} : { title: params.title })
    })

    // キャプチャ開始が失敗した場合に空の録音を残さないよう、成功後に永続化する。
    await this.deps.capture.start({
      workDir: this.deps.artifacts.workDir(recording),
      sampleRate: settings.audio.sampleRate
    })
    await this.deps.repository.save(recording)

    return recording
  }
}
