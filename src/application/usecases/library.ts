import type {
  RecordingArtifactPort,
  RecordingRepositoryPort,
  SettingsRepositoryPort
} from '@application/ports'
import type { Recording } from '@domain/Recording'
import { ConfigurationError, RecordingNotFoundError } from '@domain/errors'
import {
  isConfigured,
  mergeSettings,
  validateSettings,
  type Settings,
  type SettingsPatch
} from '@domain/Settings'
import type { Speaker } from '@domain/Speaker'
import type { TranscriptSegment } from '@domain/TranscriptSegment'

export interface LibraryDeps {
  readonly repository: RecordingRepositoryPort
  readonly artifacts: RecordingArtifactPort
}

/** 一覧に出すのに必要な情報。要約の冒頭をプレビューとして添える。 */
export interface RecordingSummaryView extends Recording {
  readonly summaryPreview: string | undefined
}

/** 詳細画面が必要とする全て。 */
export interface RecordingDetail {
  readonly recording: Recording
  readonly audioPath: string
  readonly segments: readonly TranscriptSegment[]
  readonly speakers: readonly Speaker[]
  readonly transcriptMarkdown: string
  readonly summary: string | undefined
  readonly note: string
}

const firstLine = (markdown: string | undefined): string | undefined => {
  if (!markdown) return undefined
  return markdown
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find((line) => line.length > 0)
}

export class ListRecordings {
  constructor(private readonly deps: LibraryDeps) {}

  async execute(): Promise<RecordingSummaryView[]> {
    const recordings = await this.deps.repository.list()

    return Promise.all(
      recordings.map(async (recording) => ({
        ...recording,
        summaryPreview: firstLine(await this.deps.artifacts.readSummary(recording))
      }))
    )
  }
}

export class GetRecordingDetail {
  constructor(private readonly deps: LibraryDeps) {}

  async execute(recordingId: string): Promise<RecordingDetail> {
    const recording = await findOrThrow(this.deps.repository, recordingId)
    const transcript = await this.deps.artifacts.readTranscript(recording)

    return {
      recording,
      audioPath: await this.deps.artifacts.audioPath(recording),
      segments: transcript?.segments ?? [],
      speakers: transcript?.speakers ?? [],
      transcriptMarkdown: toPlainTranscript(transcript),
      summary: await this.deps.artifacts.readSummary(recording),
      note: await this.deps.artifacts.readNote(recording)
    }
  }
}

/** コピー用のプレーンテキスト。話者ラベルを解決して読める形にする。 */
const toPlainTranscript = (
  transcript: { segments: TranscriptSegment[]; speakers: Speaker[] } | undefined
): string => {
  if (!transcript) return ''
  const labels = new Map(transcript.speakers.map((speaker) => [speaker.id, speaker.label]))

  return transcript.segments
    .map((segment) => `${labels.get(segment.speakerId) ?? segment.speakerId}: ${segment.text}`)
    .join('\n')
}

export class UpdateNote {
  constructor(private readonly deps: LibraryDeps) {}

  async execute(params: { recordingId: string; note: string }): Promise<void> {
    const recording = await findOrThrow(this.deps.repository, params.recordingId)
    await this.deps.artifacts.writeNote(recording, params.note)
  }
}

export class RenameRecording {
  constructor(private readonly deps: LibraryDeps) {}

  /**
   * タイトルだけを変える。保存ディレクトリ名（slug）は変えない。
   * 既に書き出したファイルの場所が動くと、利用者が外部ツールで開いていた
   * パスや、進行中のパイプラインの参照が壊れるため。
   */
  async execute(params: { recordingId: string; title: string }): Promise<Recording> {
    const recording = await findOrThrow(this.deps.repository, params.recordingId)
    const title = params.title.trim()
    if (title.length === 0) {
      throw new ConfigurationError('タイトルを入力してください。')
    }

    const renamed: Recording = { ...recording, title }
    await this.deps.repository.save(renamed)
    return renamed
  }
}

/** 話者に利用者が付けた名前を反映する。文字起こしの話者一覧だけを書き換える。 */
export class RenameSpeaker {
  constructor(private readonly deps: LibraryDeps) {}

  async execute(params: {
    recordingId: string
    speakerId: string
    label: string
  }): Promise<readonly Speaker[]> {
    const recording = await findOrThrow(this.deps.repository, params.recordingId)
    const transcript = await this.deps.artifacts.readTranscript(recording)
    if (!transcript) {
      throw new ConfigurationError('文字起こしがまだありません。')
    }

    const label = params.label.trim()
    if (label.length === 0) {
      throw new ConfigurationError('話者名を入力してください。')
    }

    const speakers = transcript.speakers.map((speaker) =>
      speaker.id === params.speakerId ? { ...speaker, label } : speaker
    )

    await this.deps.artifacts.writeTranscript(recording, {
      segments: transcript.segments,
      speakers
    })

    return speakers
  }
}

export class DeleteRecording {
  constructor(private readonly deps: LibraryDeps) {}

  async execute(recordingId: string): Promise<void> {
    const recording = await findOrThrow(this.deps.repository, recordingId)
    await this.deps.artifacts.removeAll(recording)
    await this.deps.repository.remove(recordingId)
  }
}

export class UpdateSettings {
  constructor(private readonly settings: SettingsRepositoryPort) {}

  async execute(patch: SettingsPatch): Promise<Settings> {
    const current = await this.settings.load()
    const errors = validateSettings(mergeSettings(current, patch))
    if (errors.length > 0) {
      throw new ConfigurationError(errors.join('\n'))
    }

    return this.settings.save(patch)
  }
}

/** 起動時に「まず何をすべきか」を判断するための状態。 */
export class GetSetupState {
  constructor(private readonly settings: SettingsRepositoryPort) {}

  async execute(): Promise<{
    settings: Settings
    needsStorageDir: boolean
    needsTranscriptionModel: boolean
    needsSummarizationModel: boolean
  }> {
    const settings = await this.settings.load()

    return {
      settings,
      needsStorageDir: !isConfigured(settings),
      needsTranscriptionModel: settings.transcription.modelPath.length === 0,
      needsSummarizationModel: settings.summarization.modelPath.length === 0
    }
  }
}

const findOrThrow = async (
  repository: RecordingRepositoryPort,
  recordingId: string
): Promise<Recording> => {
  const recording = await repository.find(recordingId)
  if (!recording) throw new RecordingNotFoundError(recordingId)
  return recording
}
