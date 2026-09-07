import type { Folder } from '@domain/Folder'
import type { PipelineStep, Recording } from '@domain/Recording'
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

/** 録音中に書き出された 2 トラックとその時間関係。 */
export interface CapturedTracks {
  readonly systemWavPath: string
  readonly micWavPath: string
  /** マイクトラックがシステム音声より遅れて開始した量。負なら先行。 */
  readonly micOffsetMs: number
  readonly durationMs: number
}

export interface AudioCapturePort {
  start(params: { workDir: string; sampleRate: number }): Promise<void>
  stop(): Promise<CapturedTracks>
  isActive(): boolean
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

  /** 停止時に確定したトラック情報。アプリ再起動後のリトライで必要になる。 */
  readTracks(recording: Recording): Promise<CapturedTracks | undefined>
  writeTracks(recording: Recording, tracks: CapturedTracks): Promise<void>

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
