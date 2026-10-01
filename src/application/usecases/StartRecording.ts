import type {
  AudioCapturePort,
  CalendarPort,
  ClockPort,
  IdGeneratorPort,
  RecordingArtifactPort,
  RecordingRepositoryPort,
  SettingsRepositoryPort
} from '@application/ports'
import {
  EARLY_START_MARGIN_MS,
  participantNames,
  pickEventForRecording,
  type CalendarEvent
} from '@domain/CalendarEvent'
import { meetingLanguageOf, type MeetingLanguage } from '@domain/MeetingLanguage'
import { createRecording, defaultTitle, type Recording } from '@domain/Recording'
import { ConfigurationError, RecordingStateError } from '@domain/errors'
import { isConfigured } from '@domain/Settings'

export interface StartRecordingDeps {
  readonly settings: SettingsRepositoryPort
  readonly repository: RecordingRepositoryPort
  readonly capture: AudioCapturePort
  readonly artifacts: RecordingArtifactPort
  readonly calendar: CalendarPort
  readonly clock: ClockPort
  readonly ids: IdGeneratorPort
  /** 文字起こしの言語が自動判定のときの会議の言語。既定のタイトルに使う（ADR-043）。 */
  readonly fallbackLanguage: MeetingLanguage
}

/** 録音を開始する。保存先が未設定、または録音中の場合は失敗する。 */
export class StartRecording {
  constructor(private readonly deps: StartRecordingDeps) {}

  async execute(params: { title?: string }): Promise<Recording> {
    if (this.deps.capture.isActive()) {
      throw new RecordingStateError({ code: 'alreadyRecording' })
    }

    const settings = await this.deps.settings.load()
    if (!isConfigured(settings)) {
      throw new ConfigurationError({ code: 'storageNotConfigured' })
    }

    const startedAt = this.deps.clock.now()
    const language = meetingLanguageOf(settings.transcription.language, this.deps.fallbackLanguage)
    const draft = createRecording({
      id: this.deps.ids.next(),
      startedAt,
      title: defaultTitle(startedAt, language)
    })
    // 予定の問い合わせはキャプチャと並べて走らせる。応答を待ってから録り始めると、
    // その間の会議の冒頭が失われる。
    const lookup = settings.recording.calendarEnabled ? this.findEvent(draft.startedAt) : Promise.resolve(undefined)

    // キャプチャ開始が失敗した場合に空の録音を残さないよう、成功後に永続化する。
    await this.deps.capture.start({
      workDir: this.deps.artifacts.workDir(draft),
      sampleRate: settings.audio.sampleRate
    })

    const recording = withEvent(draft, params.title, await lookup)
    await this.deps.repository.save(recording)

    return recording
  }

  /** 予定が引けなくても録音は始める。失うのはタイトルの初期値と候補だけ。 */
  private async findEvent(startedAt: Date): Promise<CalendarEvent | undefined> {
    try {
      const events = await this.deps.calendar.eventsBetween({
        from: startedAt,
        to: new Date(startedAt.getTime() + EARLY_START_MARGIN_MS)
      })
      return pickEventForRecording(events, startedAt)
    } catch {
      return undefined
    }
  }
}

/**
 * 指定されたタイトルがあればそれを、無ければ予定のタイトルを使う。どちらも空なら、
 * 下書きに付けた既定のタイトルのまま。
 */
const withEvent = (draft: Recording, title: string | undefined, event: CalendarEvent | undefined): Recording => {
  const chosen = (title ?? event?.title)?.trim()
  const participants = event ? participantNames(event) : []

  return {
    ...draft,
    ...(chosen ? { title: chosen } : {}),
    ...(participants.length > 0 ? { participants } : {})
  }
}
