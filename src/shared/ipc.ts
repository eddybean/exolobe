import type { PipelineStep, Recording, RecordingStatus } from '@domain/Recording'
import type { Settings, SettingsPatch } from '@domain/Settings'
import type { Speaker } from '@domain/Speaker'
import type { TranscriptSegment } from '@domain/TranscriptSegment'

/**
 * main / renderer 間の契約。
 *
 * Date や class のインスタンスは structured clone で往復させると扱いが面倒なので、
 * 境界を越えるデータはプリミティブと素の object だけで表す（クリーンアーキテクチャの
 * 「境界は DTO で渡す」に対応）。
 */

export interface RecordingDto {
  readonly id: string
  readonly title: string
  /** ISO 8601 文字列。 */
  readonly startedAt: string
  readonly durationMs: number
  readonly status: RecordingStatus
  readonly steps: Record<PipelineStep, { status: string; error?: string }>
  readonly slug: string
  readonly summaryPreview?: string
}

export interface RecordingDetailDto {
  readonly recording: RecordingDto
  readonly audioPath: string
  readonly segments: readonly TranscriptSegment[]
  readonly speakers: readonly Speaker[]
  readonly transcriptText: string
  readonly summary?: string
  readonly note: string
}

export interface SetupStateDto {
  readonly settings: Settings
  readonly needsStorageDir: boolean
  readonly needsTranscriptionModel: boolean
  readonly needsSummarizationModel: boolean
}

/** 録音中に UI が表示する状態。 */
export interface TransportStateDto {
  readonly recordingId?: string
  readonly title?: string
  readonly startedAtMs?: number
  readonly active: boolean
}

/** モデル取得の進捗。UI はこれで各行のバーを描く。 */
export interface ModelProgressDto {
  readonly id: string
  readonly receivedBytes: number
  readonly totalBytes?: number
  readonly status: 'downloading' | 'done' | 'failed' | 'cancelled'
  readonly error?: string
}

export interface ManagedAssetStatusDto {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly bytes: number
  readonly optional: boolean
  readonly installed: boolean
  readonly path?: string
}

export interface ProgressEventDto {
  readonly recordingId: string
  readonly step: PipelineStep
  readonly status: 'running' | 'done' | 'failed'
  readonly error?: string
}

export const toRecordingDto = (
  recording: Recording,
  summaryPreview?: string
): RecordingDto => ({
  id: recording.id,
  title: recording.title,
  startedAt: recording.startedAt.toISOString(),
  durationMs: recording.durationMs,
  status: recording.status,
  steps: recording.steps as RecordingDto['steps'],
  slug: recording.slug,
  ...(summaryPreview === undefined ? {} : { summaryPreview })
})

/** preload が contextBridge で公開する API の形。renderer はこれだけを見る。 */
export interface RendererApi {
  listRecordings(): Promise<RecordingDto[]>
  getRecording(id: string): Promise<RecordingDetailDto>
  startRecording(title?: string): Promise<RecordingDto>
  stopRecording(): Promise<RecordingDto>
  getTransportState(): Promise<TransportStateDto>
  retryStep(recordingId: string, step: PipelineStep): Promise<RecordingDto>
  updateNote(recordingId: string, note: string): Promise<void>
  renameRecording(recordingId: string, title: string): Promise<RecordingDto>
  renameSpeaker(recordingId: string, speakerId: string, label: string): Promise<Speaker[]>
  deleteRecording(recordingId: string): Promise<void>
  /** 削除前の確認。ネイティブダイアログを出し、実行してよければ true を返す。 */
  confirmDeleteRecording(recordingId: string): Promise<boolean>
  revealRecording(recordingId: string): Promise<void>

  getSetupState(): Promise<SetupStateDto>
  getModelStatus(): Promise<ManagedAssetStatusDto[]>
  downloadModel(id: string): Promise<Settings>
  cancelModelDownload(id: string): Promise<void>
  updateSettings(patch: SettingsPatch): Promise<Settings>
  chooseStorageDir(): Promise<string | undefined>
  chooseFile(kind: 'whisper-model' | 'llm-model' | 'onnx-model'): Promise<string | undefined>

  /** レンダラーの AudioWorklet が集めたマイク PCM を main へ渡す。 */
  pushMicPcm(pcm: ArrayBuffer): void

  onProgress(listener: (event: ProgressEventDto) => void): () => void
  onRecordingsChanged(listener: () => void): () => void
  onTransportChanged(listener: (state: TransportStateDto) => void): () => void
  onModelProgress(listener: (event: ModelProgressDto) => void): () => void
}

/** IPC チャンネル名。main と preload で共有し、綴りのずれを防ぐ。 */
export const IPC = {
  listRecordings: 'recordings:list',
  getRecording: 'recordings:get',
  startRecording: 'transport:start',
  stopRecording: 'transport:stop',
  getTransportState: 'transport:state',
  retryStep: 'pipeline:retry',
  updateNote: 'recordings:updateNote',
  renameRecording: 'recordings:rename',
  renameSpeaker: 'recordings:renameSpeaker',
  deleteRecording: 'recordings:delete',
  confirmDeleteRecording: 'recordings:confirmDelete',
  revealRecording: 'recordings:reveal',
  getSetupState: 'settings:setupState',
  getModelStatus: 'models:status',
  downloadModel: 'models:download',
  cancelModelDownload: 'models:cancel',
  modelProgress: 'models:progress',
  updateSettings: 'settings:update',
  chooseStorageDir: 'settings:chooseStorageDir',
  chooseFile: 'settings:chooseFile',
  pushMicPcm: 'transport:micPcm',
  progress: 'pipeline:progress',
  recordingsChanged: 'recordings:changed',
  transportChanged: 'transport:changed'
} as const
