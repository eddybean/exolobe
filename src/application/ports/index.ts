import type { Folder } from '@domain/Folder'
import type { MemorySnapshot } from '@domain/MemoryGuard'
import type { PipelineStep, Recording } from '@domain/Recording'
import type { DualTrackSource, RecordingSource } from '@domain/RecordingSource'
import type { ChunkLocator, SearchSource } from '@domain/SemanticSearch'
import type { AudioCodec, Settings, SettingsPatch } from '@domain/Settings'
import type { Speaker } from '@domain/Speaker'
import type { SpeakerTurn, TranscriptSegment } from '@domain/TranscriptSegment'

/**
 * 内側の層が外界に触れるための境界。実装はすべて infrastructure 層に置き、
 * main/container.ts でのみ結線する。ユースケースはここの型しか知らない。
 */

/** 現在時刻。テストで固定できるよう注入する。 */
export interface ClockPort {
  now(): Date
}

/** 録音 ID の採番。 */
export interface IdGeneratorPort {
  next(): string
}

/**
 * パイプラインが読む音の素材。定義は domain にあり、ここからは再公開するだけ。
 * 内側の層（ユースケース）が「録音か取り込みか」を業務の語彙で扱えるようにするため。
 */
export type { DualTrackSource, ImportedTrackSource, RecordingSource } from '@domain/RecordingSource'

export interface AudioCapturePort {
  start(params: { workDir: string; sampleRate: number }): Promise<void>
  /** 録音は常に 2 トラックなので、取り込みを含む union より狭い型を返す。 */
  stop(): Promise<DualTrackSource>
  isActive(): boolean
  /**
   * 前回の読み出し以降に届いたシステム音声の peak（0〜1）。
   * UI の入力レベル表示専用で、録音の成果物には影響しない。
   */
  systemLevel(): number
}

/** 2 トラックを時刻整列して 1 本の WAV にまとめる。 */
export interface AudioMixerPort {
  mix(params: {
    tracks: readonly { path: string; offsetMs: number }[]
    outputPath: string
  }): Promise<{ durationMs: number }>
}

/** WAV を配布用の圧縮音声へ変換する。 */
export interface AudioEncoderPort {
  encode(params: {
    inputPath: string
    outputPath: string
    codec: AudioCodec
    bitrateKbps: number
  }): Promise<void>
}

export interface TranscriptionPort {
  transcribe(params: {
    wavPath: string
    language: string
    /** 得られた全セグメントに付与する話者 ID。トラック＝話者なので呼び出し側が決める。 */
    speakerId: string
    signal?: AbortSignal
  }): Promise<TranscriptSegment[]>
}

export interface DiarizationPort {
  diarize(params: {
    wavPath: string
    maxSpeakers: number
    signal?: AbortSignal
  }): Promise<SpeakerTurn[]>
}

export interface SummarizationPort {
  summarize(params: {
    transcript: string
    promptTemplate: string
    signal?: AbortSignal
  }): Promise<string>
}

/**
 * OS 側の資源。重い推論に入る前の判断材料をユースケースへ渡す。
 *
 * ファイルサイズを同居させているのは、所要メモリの見積もりに実ファイルの大きさが
 * 要るため。ModelCatalog の bytes はカタログ上の期待値でしかなく、利用者が自分の
 * GGUF を選んだ場合には当てにならない。
 */
export interface SystemResourcePort {
  memory(): Promise<MemorySnapshot>
  /** 存在しない・読めない場合は undefined。 */
  fileSize(path: string): Promise<number | undefined>
}

/** 録音のメタデータ一覧。保存先ルート配下の index.json が実体。 */
export interface RecordingRepositoryPort {
  list(): Promise<Recording[]>
  find(id: string): Promise<Recording | undefined>
  save(recording: Recording): Promise<void>
  remove(id: string): Promise<void>
}

/** 1 件の録音に紐づくファイル群（音声・文字起こし・要約・メモ）。 */
export interface RecordingArtifactPort {
  workDir(recording: Recording): string
  /** 保存先に置く最終音声のパス。保存先は設定で変わるため非同期に解決する。 */
  audioPath(recording: Recording): Promise<string>

  /**
   * パイプラインの入力となる音の素材。アプリ再起動後のリトライで必要になる。
   * メソッド名と保存先のファイル名（tracks.json）は 2 トラック録音しか無かった頃のまま。
   */
  readTracks(recording: Recording): Promise<RecordingSource | undefined>
  writeTracks(recording: Recording, tracks: RecordingSource): Promise<void>

  readTranscript(
    recording: Recording
  ): Promise<{ segments: TranscriptSegment[]; speakers: Speaker[] } | undefined>
  writeTranscript(
    recording: Recording,
    data: { segments: readonly TranscriptSegment[]; speakers: readonly Speaker[] }
  ): Promise<void>

  readSummary(recording: Recording): Promise<string | undefined>
  writeSummary(recording: Recording, markdown: string): Promise<void>

  readNote(recording: Recording): Promise<string>
  writeNote(recording: Recording, markdown: string): Promise<void>

  /** エンコード後に不要になる中間 WAV を片付ける。 */
  cleanupIntermediates(recording: Recording): Promise<void>
  removeAll(recording: Recording): Promise<void>
}

/** フォルダの定義（id/名前/親子関係）。保存先ルートの folders.json が実体。 */
export interface FolderRepositoryPort {
  list(): Promise<Folder[]>
  replaceAll(folders: readonly Folder[]): Promise<void>
}

export interface SettingsRepositoryPort {
  load(): Promise<Settings>
  save(patch: SettingsPatch): Promise<Settings>
}

/** パイプラインの進捗を UI へ伝える。 */
export interface ProgressReporterPort {
  report(event: {
    recordingId: string
    step: PipelineStep
    status: 'running' | 'done' | 'failed'
    error?: string
  }): void
}

/** 文字列を意味のベクトルにする（意味検索用）。 */
export interface TextEmbedderPort {
  /**
   * 埋め込みの互換性を表すキー。モデルが変われば値が変わり、
   * それ以前に作ったベクトルとは比較できない。
   */
  readonly modelKey: string
  /**
   * モデルを読み込み済みか。
   * 読み込み済みならメモリは既に確保されているので、所要量を二重に数えない。
   */
  readonly loaded: boolean
  /** 長さ 1 に正規化したベクトルを返す。 */
  embed(text: string): Promise<Float32Array>
}

export interface IndexedChunk {
  readonly source: SearchSource
  readonly locator: ChunkLocator
  readonly vector: Float32Array
}

/** 1 件の録音の索引。本文は持たず、位置とベクトルだけを持つ。 */
export interface SearchIndexEntry {
  readonly recordingId: string
  readonly fingerprint: string
  readonly modelKey: string
  readonly chunks: readonly IndexedChunk[]
}

/** 意味検索の索引。再生成できるキャッシュであり、消えても録音は失われない。 */
export interface SearchIndexPort {
  list(): Promise<SearchIndexEntry[]>
  put(entry: SearchIndexEntry): Promise<void>
  remove(recordingId: string): Promise<void>
  clear(): Promise<void>
  /** 索引が占めている件数と容量。設定画面で消すかどうかの判断材料にする。 */
  stats(): Promise<{ count: number; bytes: number }>
}
