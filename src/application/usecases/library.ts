import type {
  ClockPort,
  RecordingArtifactPort,
  RecordingRepositoryPort,
  SettingsRepositoryPort,
  VoiceExtractionPort,
  VoiceprintRepositoryPort
} from '@application/ports'
import { transcriptEditBlocker, type Recording } from '@domain/Recording'
import { ConfigurationError, RecordingNotFoundError } from '@domain/errors'
import type { Bookmark } from '@domain/MeetingNotes'
import {
  isConfigured,
  mergeSettings,
  validateSettings,
  type Settings,
  type SettingsPatch
} from '@domain/Settings'
import { isRemoteSpeakerId, type Speaker } from '@domain/Speaker'
import { forgetSource, registerVoice, voiceSourceKey, type Voiceprint } from '@domain/Voiceprint'
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
  readonly bookmarks: readonly Bookmark[]
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
      note: await this.deps.artifacts.readNote(recording),
      bookmarks: await this.deps.artifacts.readBookmarks(recording)
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

/**
 * 録音中に「今の発言に印をつける」を押した時点を残す（ADR-042）。
 *
 * 時刻は録音開始からの経過ミリ秒で、画面側が数える。押した瞬間の値を残すだけで、
 * 録音中に推論はしない（ADR-009）。
 */
export class AddBookmark {
  constructor(private readonly deps: LibraryDeps) {}

  async execute(params: { recordingId: string; atMs: number }): Promise<void> {
    const recording = await findOrThrow(this.deps.repository, params.recordingId)
    const bookmarks = await this.deps.artifacts.readBookmarks(recording)
    const atMs = Math.max(0, Math.round(params.atMs))

    await this.deps.artifacts.writeBookmarks(
      recording,
      [...bookmarks, { atMs }].sort((a, b) => a.atMs - b.atMs)
    )
  }
}

/**
 * 手で直した要約を保存する。
 *
 * 生成した要約と区別して持たない。再要約すれば上書きされるが、それは画面で
 * 確認を取ってから行う。区別を持つと、要約を読む側（一覧・検索・チャット）が
 * どちらを見るかを決め直すことになる。
 */
export class UpdateSummary {
  constructor(private readonly deps: LibraryDeps) {}

  async execute(params: { recordingId: string; summary: string }): Promise<void> {
    const recording = await findOrThrow(this.deps.repository, params.recordingId)
    await this.deps.artifacts.writeSummary(recording, params.summary)
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

/**
 * 話者に利用者が付けた名前を反映する。文字起こしの話者一覧だけを書き換える。
 *
 * 声紋帳への登録は `RememberSpeakerVoice` が受け持つ。声紋の取り直しが要る録音では
 * 数十秒かかることがあり、名前の反映まで待たせないために分けてある。
 */
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

/**
 * 文字起こしの 1 セグメントの本文を、利用者が音声を聞いて直した内容に置き換える。
 *
 * 変えるのは本文だけで、区間・話者・セグメントの数と並びは保つ。意味検索の索引は
 * 本文を持たずセグメントの位置（配列の添字）だけを持つため、数や並びが動くと
 * 索引が別の発言を指してしまう。
 *
 * セグメントは id を持たないので、画面が見ていた位置と開始時刻の組で指す。
 * 食い違うのは画面を開いた後に文字起こしが作り直された場合で、そのまま書くと
 * 別の発言を上書きしてしまう。
 */
export class EditSegmentText {
  constructor(private readonly deps: LibraryDeps) {}

  async execute(params: {
    recordingId: string
    index: number
    startMs: number
    text: string
  }): Promise<readonly TranscriptSegment[]> {
    const recording = await findOrThrow(this.deps.repository, params.recordingId)
    const blocker = transcriptEditBlocker(recording.steps)
    if (blocker) {
      throw new ConfigurationError(blocker)
    }

    const transcript = await this.deps.artifacts.readTranscript(recording)
    if (!transcript) {
      throw new ConfigurationError('文字起こしがまだありません。')
    }

    // transcript.md は 1 発言を 1 行に書く。貼り付けなどで混ざった改行は空白に畳む。
    const text = params.text.replace(/\s*[\r\n]+\s*/g, ' ').trim()
    if (text.length === 0) {
      throw new ConfigurationError('本文を入力してください。')
    }

    const target = transcript.segments[params.index]
    if (!target || target.startMs !== params.startMs) {
      throw new ConfigurationError('文字起こしが更新されています。画面を開き直してください。')
    }

    const segments = transcript.segments.map((segment, index) =>
      index === params.index ? { ...segment, text } : segment
    )

    await this.deps.artifacts.writeTranscript(recording, {
      segments,
      speakers: transcript.speakers
    })

    return segments
  }
}

/** 声紋を覚えられたか。覚えられなかった理由は利用者に見せる。 */
export type VoiceMemoryResult = 'remembered' | 'skipped-self' | 'unavailable'

export interface RememberSpeakerVoiceDeps extends LibraryDeps {
  readonly voiceprints: VoiceprintRepositoryPort
  readonly voices: VoiceExtractionPort
  readonly clock: ClockPort
}

/**
 * 名前を付けた話者の声紋を声紋帳へ登録し、古い名前からは取り消す。
 *
 * 声紋帳が育つのはここだけ（ADR-031）。**呼ぶのは話者のリネームを受けた 1 か所に
 * 限る**こと。自動で当てた名前を再登録すると、一度の取り違えが声紋に混ざって
 * 次の取り違えを呼ぶ。利用者が「田中さん」を「佐藤さん」に直せば、その声は
 * 佐藤さんとして登録され、田中さんの声紋は触られない。
 *
 * 自分（マイクトラック）は録音のたびに確定していて引き当てる必要がないため、
 * 相手側の話者だけを対象にする。
 *
 * 取り消しまでが訂正の一部。「田中さん」を「佐藤さん」に直したのに田中さん側が
 * 同じベクトルのまま残ると、次の録音で 1 位と 2 位が同点になり、
 * 「差が無いなら当てにいかない」規則で両方とも弾かれる。
 */
export class RememberSpeakerVoice {
  constructor(private readonly deps: RememberSpeakerVoiceDeps) {}

  async execute(params: {
    recordingId: string
    speakerId: string
    label: string
  }): Promise<VoiceMemoryResult> {
    if (!isRemoteSpeakerId(params.speakerId)) return 'skipped-self'

    const recording = await findOrThrow(this.deps.repository, params.recordingId)

    let voices = await this.deps.artifacts.readVoices(recording)
    let vector = vectorOf(voices, params.speakerId)

    // 話者識別が終わった後に名前を付けるのが普通の使い方で、その頃には中間 WAV が
    // 消えている。声紋が無ければ保存済みの音声から取り直す（失敗は理由ごと投げる）。
    if (!vector) {
      await this.deps.voices.extract(params.recordingId)
      voices = await this.deps.artifacts.readVoices(recording)
      vector = vectorOf(voices, params.speakerId)
    }
    if (!voices || !vector) return 'unavailable'

    const name = params.label.trim()
    const source = voiceSourceKey(recording.id, params.speakerId)
    const now = this.deps.clock.now()
    const registry = await this.deps.voiceprints.list()

    for (const entry of registry) {
      if (entry.name === name) continue
      const remaining = forgetSource(entry, source, now)
      if (remaining === entry) continue
      if (remaining) await this.deps.voiceprints.put(remaining)
      else await this.deps.voiceprints.remove(entry.name)
    }

    await this.deps.voiceprints.put(
      registerVoice(
        registry.find((entry) => entry.name === name),
        { name, source, vector, modelKey: voices.modelKey, now }
      )
    )

    return 'remembered'
  }
}

const vectorOf = (
  voices: { speakers: readonly { speakerId: string; vector: Float32Array }[] } | undefined,
  speakerId: string
): Float32Array | undefined =>
  voices?.speakers.find((speaker) => speaker.speakerId === speakerId)?.vector

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

/**
 * 設定画面に出す声紋帳の 1 件。
 *
 * ベクトルは渡さない。画面が使うのは名前と、どれだけ育っているかだけで、
 * 192 個の数値を IPC の境界越しに運ぶ理由が無い。
 */
export interface VoiceprintView {
  readonly name: string
  readonly samples: number
  readonly updatedAt: string
}

const toView = (voiceprint: Voiceprint): VoiceprintView => ({
  name: voiceprint.name,
  samples: voiceprint.sources.length,
  updatedAt: voiceprint.updatedAt
})

/** 新しく覚えた順に並べる。直前に付けた名前が上に来るほうが確かめやすい。 */
const listViews = async (voiceprints: VoiceprintRepositoryPort): Promise<VoiceprintView[]> =>
  (await voiceprints.list())
    .map(toView)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

export class ListVoiceprints {
  constructor(private readonly voiceprints: VoiceprintRepositoryPort) {}

  async execute(): Promise<VoiceprintView[]> {
    return listViews(this.voiceprints)
  }
}

/** 覚え違いを消す。消しても録音と付けた名前はそのまま残り、次回から当たらなくなるだけ。 */
export class RemoveVoiceprint {
  constructor(private readonly voiceprints: VoiceprintRepositoryPort) {}

  async execute(name: string): Promise<void> {
    await this.voiceprints.remove(name)
  }
}

export class ClearVoiceprints {
  constructor(private readonly voiceprints: VoiceprintRepositoryPort) {}

  async execute(): Promise<void> {
    await this.voiceprints.clear()
  }
}
