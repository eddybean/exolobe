import type {
  AudioCapturePort,
  AudioDecoderPort,
  AudioEncoderPort,
  AudioMixerPort,
  ChatCompletionPort,
  ChatTurn,
  DualTrackSource,
  ClockPort,
  DiarizationPort,
  FileInfoPort,
  FolderRepositoryPort,
  IdGeneratorPort,
  ProgressReporterPort,
  RecordingArtifactPort,
  RecordingFinderPort,
  RecordingRepositoryPort,
  RecordingSource,
  RecordingVoices,
  SearchIndexEntry,
  SearchIndexPort,
  SettingsRepositoryPort,
  SpeakerEmbeddingPort,
  SummarizationPort,
  SystemResourcePort,
  TextEmbedderPort,
  TranscriptionPort,
  Voiceprint,
  VoiceprintRepositoryPort
} from '@application/ports'
import type { Folder } from '@domain/Folder'
import { normalize } from '@domain/vector'
import type { MemorySnapshot } from '@domain/MemoryGuard'
import type { PipelineStep, Recording } from '@domain/Recording'
import {
  defaultSettings,
  mergeSettings,
  type AudioCodec,
  type Settings,
  type SettingsPatch
} from '@domain/Settings'
import type { Speaker } from '@domain/Speaker'
import type { SpeakerTurn, TranscriptSegment } from '@domain/TranscriptSegment'

/** I/O を伴わないテスト用の代替実装。ユースケースはこれだけで完全に検証できる。 */

export class FakeClock implements ClockPort {
  constructor(private current: Date) {}
  now(): Date {
    return this.current
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }
}

export class FakeIdGenerator implements IdGeneratorPort {
  private counter = 0
  next(): string {
    this.counter += 1
    return `rec-${this.counter}`
  }
}

export class FakeAudioCapture implements AudioCapturePort {
  active = false
  startCalls: { workDir: string; sampleRate: number }[] = []
  tracks: DualTrackSource = {
    kind: 'dual',
    systemWavPath: '/work/system.wav',
    micWavPath: '/work/mic.wav',
    micOffsetMs: 120,
    durationMs: 65_000
  }
  startError?: Error
  /** UI の音量メーター用に返すシステム音声のレベル。 */
  level = 0

  async start(params: { workDir: string; sampleRate: number }): Promise<void> {
    if (this.startError) throw this.startError
    this.startCalls.push(params)
    this.active = true
  }
  async stop(): Promise<DualTrackSource> {
    this.active = false
    return this.tracks
  }
  isActive(): boolean {
    return this.active
  }
  systemLevel(): number {
    return this.active ? this.level : 0
  }
}

export class FakeRecordingRepository implements RecordingRepositoryPort {
  readonly records = new Map<string, Recording>()

  async list(): Promise<Recording[]> {
    return [...this.records.values()].sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
    )
  }
  async find(id: string): Promise<Recording | undefined> {
    return this.records.get(id)
  }
  async save(recording: Recording): Promise<void> {
    this.records.set(recording.id, recording)
  }
  async remove(id: string): Promise<void> {
    this.records.delete(id)
  }
}

export class FakeFolderRepository implements FolderRepositoryPort {
  folders: Folder[] = []

  async list(): Promise<Folder[]> {
    return this.folders
  }
  async replaceAll(folders: readonly Folder[]): Promise<void> {
    this.folders = [...folders]
  }
}

export class FakeArtifactStore implements RecordingArtifactPort {
  transcripts = new Map<string, { segments: TranscriptSegment[]; speakers: Speaker[] }>()
  summaries = new Map<string, string>()
  notes = new Map<string, string>()
  voices = new Map<string, RecordingVoices>()
  cleanedUp: string[] = []
  removed: string[] = []

  tracks = new Map<string, RecordingSource>()

  workDir(recording: Recording): string {
    return `/work/${recording.id}`
  }
  async readTracks(recording: Recording): Promise<RecordingSource | undefined> {
    return this.tracks.get(recording.id)
  }
  async writeTracks(recording: Recording, tracks: RecordingSource): Promise<void> {
    this.tracks.set(recording.id, tracks)
  }
  async audioPath(recording: Recording): Promise<string> {
    return `/storage/${recording.slug}/audio.m4a`
  }
  async readTranscript(
    recording: Recording
  ): Promise<{ segments: TranscriptSegment[]; speakers: Speaker[] } | undefined> {
    return this.transcripts.get(recording.id)
  }
  async writeTranscript(
    recording: Recording,
    data: { segments: readonly TranscriptSegment[]; speakers: readonly Speaker[] }
  ): Promise<void> {
    this.transcripts.set(recording.id, {
      segments: [...data.segments],
      speakers: [...data.speakers]
    })
  }
  async readVoices(recording: Recording): Promise<RecordingVoices | undefined> {
    return this.voices.get(recording.id)
  }
  async writeVoices(recording: Recording, voices: RecordingVoices): Promise<void> {
    this.voices.set(recording.id, voices)
  }
  async readSummary(recording: Recording): Promise<string | undefined> {
    return this.summaries.get(recording.id)
  }
  async writeSummary(recording: Recording, markdown: string): Promise<void> {
    this.summaries.set(recording.id, markdown)
  }
  async readNote(recording: Recording): Promise<string> {
    return this.notes.get(recording.id) ?? ''
  }
  async writeNote(recording: Recording, markdown: string): Promise<void> {
    this.notes.set(recording.id, markdown)
  }
  async cleanupIntermediates(recording: Recording): Promise<void> {
    this.cleanedUp.push(recording.id)
  }
  async removeAll(recording: Recording): Promise<void> {
    this.removed.push(recording.id)
    this.transcripts.delete(recording.id)
    this.voices.delete(recording.id)
    this.summaries.delete(recording.id)
    this.notes.delete(recording.id)
  }
}

export class FakeSettingsRepository implements SettingsRepositoryPort {
  constructor(private settings: Settings = { ...defaultSettings(), storageDir: '/storage' }) {}
  async load(): Promise<Settings> {
    return this.settings
  }
  async save(patch: SettingsPatch): Promise<Settings> {
    this.settings = mergeSettings(this.settings, patch)
    return this.settings
  }
}

export class FakeTranscriber implements TranscriptionPort {
  /** wavPath ごとに返すセグメント。テキストのみ指定し話者は呼び出し側の指定で埋める。 */
  byPath = new Map<string, { startMs: number; endMs: number; text: string }[]>()
  calls: { wavPath: string; speakerId: string }[] = []
  error?: Error

  async transcribe(params: {
    wavPath: string
    language: string
    speakerId: string
  }): Promise<TranscriptSegment[]> {
    if (this.error) throw this.error
    this.calls.push({ wavPath: params.wavPath, speakerId: params.speakerId })
    return (this.byPath.get(params.wavPath) ?? []).map((s) => ({
      ...s,
      speakerId: params.speakerId
    }))
  }
}

export class FakeDiarizer implements DiarizationPort {
  turns: SpeakerTurn[] = []
  calls = 0
  /** 最後に話者識別へ渡された WAV。どの素材にかけたかを確かめる。 */
  lastWavPath?: string
  error?: Error

  async diarize(params: { wavPath: string }): Promise<SpeakerTurn[]> {
    this.calls += 1
    this.lastWavPath = params.wavPath
    if (this.error) throw this.error
    return this.turns
  }
}

export class FakeSpeakerEmbedder implements SpeakerEmbeddingPort {
  readonly modelKey = 'fake-embedding:2'
  /** クラスタ名ごとに返す声紋。登録の無いクラスタは結果に含めない。 */
  byCluster = new Map<string, Float32Array>()
  calls: { wavPath: string; clusters: string[] }[] = []
  error?: Error

  async embedSpeakers(params: {
    wavPath: string
    turns: readonly SpeakerTurn[]
  }): Promise<{ speaker: string; vector: Float32Array }[]> {
    const clusters = [...new Set(params.turns.map((turn) => turn.speaker))]
    this.calls.push({ wavPath: params.wavPath, clusters })
    if (this.error) throw this.error

    return clusters.flatMap((speaker) => {
      const vector = this.byCluster.get(speaker)
      return vector ? [{ speaker, vector }] : []
    })
  }
}

export class FakeVoiceprintRepository implements VoiceprintRepositoryPort {
  entries: Voiceprint[] = []

  async list(): Promise<Voiceprint[]> {
    return [...this.entries]
  }
  async put(voiceprint: Voiceprint): Promise<void> {
    this.entries = [...this.entries.filter((e) => e.name !== voiceprint.name), voiceprint]
  }
  async remove(name: string): Promise<void> {
    this.entries = this.entries.filter((e) => e.name !== name)
  }
  async clear(): Promise<void> {
    this.entries = []
  }
}

export class FakeSummarizer implements SummarizationPort {
  result = '## 概要\nテスト要約'
  receivedTranscript?: string
  error?: Error

  clearError(): void {
    delete this.error
  }

  async summarize(params: { transcript: string; promptTemplate: string }): Promise<string> {
    if (this.error) throw this.error
    this.receivedTranscript = params.transcript
    return this.result
  }
}

/** 断片を順に流し、連結を返す。ストリーミングの配線をモデル無しで確かめられる。 */
export class FakeChatCompletion implements ChatCompletionPort {
  calls: { system: string; history: readonly ChatTurn[]; prompt: string }[] = []
  chunks = ['決ま', 'ったことは', '見積もりの提出です。']
  error?: Error

  async complete(params: {
    system: string
    history: readonly ChatTurn[]
    prompt: string
    onChunk: (text: string) => void
    signal?: AbortSignal
  }): Promise<string> {
    if (this.error) throw this.error
    this.calls.push({ system: params.system, history: params.history, prompt: params.prompt })
    for (const chunk of this.chunks) {
      if (params.signal?.aborted) break
      params.onChunk(chunk)
    }
    return this.chunks.join('')
  }
}

export class FakeRecordingFinder implements RecordingFinderPort {
  calls: { topic: string; limit: number }[] = []
  ids: string[] = []
  error?: Error

  async find(params: { topic: string; limit: number }): Promise<readonly string[]> {
    if (this.error) throw this.error
    this.calls.push(params)
    return this.ids
  }
}

export class FakeMixer implements AudioMixerPort {
  calls: { tracks: readonly { path: string; offsetMs: number }[]; outputPath: string }[] = []
  durationMs = 65_000
  error?: Error

  async mix(params: {
    tracks: readonly { path: string; offsetMs: number }[]
    outputPath: string
  }): Promise<{ durationMs: number }> {
    if (this.error) throw this.error
    this.calls.push(params)
    return { durationMs: this.durationMs }
  }
}

export class FakeEncoder implements AudioEncoderPort {
  calls: { inputPath: string; outputPath: string; codec: AudioCodec; bitrateKbps: number }[] = []
  error?: Error

  async encode(params: {
    inputPath: string
    outputPath: string
    codec: AudioCodec
    bitrateKbps: number
  }): Promise<void> {
    if (this.error) throw this.error
    this.calls.push(params)
  }
}

export class FakeAudioDecoder implements AudioDecoderPort {
  calls: { inputPath: string; outputPath: string; sampleRate: number }[] = []
  durationMs = 65_000
  error?: Error

  async decode(params: {
    inputPath: string
    outputPath: string
    sampleRate: number
  }): Promise<{ durationMs: number }> {
    if (this.error) throw this.error
    this.calls.push(params)
    return { durationMs: this.durationMs }
  }
}

export class FakeFileInfo implements FileInfoPort {
  /** パスごとの素性。未登録なら「読めない」として undefined を返す。 */
  entries = new Map<string, { sizeBytes: number; modifiedAt: Date }>()

  async stat(path: string): Promise<{ sizeBytes: number; modifiedAt: Date } | undefined> {
    return this.entries.get(path)
  }
}

export class FakeProgressReporter implements ProgressReporterPort {
  events: { recordingId: string; step: PipelineStep; status: string; error?: string }[] = []

  report(event: {
    recordingId: string
    step: PipelineStep
    status: 'running' | 'done' | 'failed'
    error?: string
  }): void {
    this.events.push(event)
  }
}

export class FakeSystemResource implements SystemResourcePort {
  /** 既定は 16GB 中 14GB 空き。どのステップも通る状態。 */
  snapshot: MemorySnapshot = {
    totalBytes: 16 * 1_024 ** 3,
    availableBytes: 14 * 1_024 ** 3
  }
  /** パスごとのファイルサイズ。未登録なら undefined を返す。 */
  sizes = new Map<string, number>()

  async memory(): Promise<MemorySnapshot> {
    return this.snapshot
  }
  async fileSize(path: string): Promise<number | undefined> {
    return this.sizes.get(path)
  }
}

/**
 * キーワードの有無をそのまま次元にした擬似的な埋め込み。
 * 同じ語を含む文どうしが近くなるので、順位付けの流れを本物のモデル無しで確かめられる。
 */
export class FakeTextEmbedder implements TextEmbedderPort {
  static readonly KEYWORDS = ['雨', '予算', '採用'] as const
  modelKey = 'fake-model'
  calls: string[] = []
  error?: Error
  loaded = false

  async embed(text: string): Promise<Float32Array> {
    if (this.error) throw this.error
    this.calls.push(text)
    this.loaded = true
    // 末尾の小さな定数は、どの語も含まない文をゼロベクトルにしないため。
    return normalize([
      ...FakeTextEmbedder.KEYWORDS.map((keyword) => (text.includes(keyword) ? 1 : 0)),
      0.01
    ])
  }
}

export class FakeSearchIndex implements SearchIndexPort {
  readonly entries = new Map<string, SearchIndexEntry>()
  cleared = 0

  async list(): Promise<SearchIndexEntry[]> {
    return [...this.entries.values()]
  }
  async put(entry: SearchIndexEntry): Promise<void> {
    this.entries.set(entry.recordingId, entry)
  }
  async remove(recordingId: string): Promise<void> {
    this.entries.delete(recordingId)
  }
  async clear(): Promise<void> {
    this.cleared += 1
    this.entries.clear()
  }
  async stats(): Promise<{ count: number; bytes: number }> {
    return { count: this.entries.size, bytes: this.entries.size * 1_000 }
  }
}
