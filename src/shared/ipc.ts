import type { Folder } from '@domain/Folder'
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
  /** 分類先フォルダの id。未設定なら未分類。 */
  readonly folderId?: string
}

export interface FolderDto {
  readonly id: string
  readonly name: string
  readonly parentId?: string
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

/**
 * 無音が続いていることの知らせ。録音は止めず、UI に確認を出させる。
 */
export interface SilenceAlertDto {
  readonly recordingId: string
  /** 無音とみなした継続時間（設定値）。 */
  readonly silentDurationMs: number
}

/**
 * 会議が始まっていそうなのに録音していないことの知らせ。
 * 勝手には始めず、UI に確認を出させる。
 */
export interface StartAlertDto {
  /** マイクが使われているとみなした継続時間（設定値）。 */
  readonly micBusyDurationMs: number
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

/** 意味検索の 1 件の結果。関連度の高い順に並ぶ。 */
export interface SearchHitDto {
  readonly recordingId: string
  readonly title: string
  /** ISO 8601 文字列。 */
  readonly startedAt: string
  readonly score: number
  readonly source: 'title' | 'summary' | 'note' | 'transcript'
  /** 当たった箇所の抜粋。なぜ当たったのかを利用者が確かめられるようにする。 */
  readonly excerpt: string
  /** 文字起こしで当たった場合の、該当区間の開始時刻。 */
  readonly startMs?: number
}

/** 索引をバックグラウンドで録音一覧に合わせる処理の状態。 */
export type SearchSyncStateDto =
  | { readonly state: 'idle' }
  /** 録音やその後処理が終わるのを待っている。 */
  | { readonly state: 'waiting' }
  | { readonly state: 'running'; readonly done: number; readonly total: number }
  | { readonly state: 'error'; readonly message: string }

export interface SearchIndexStatusDto {
  readonly enabled: boolean
  readonly modelInstalled: boolean
  readonly indexedCount: number
  readonly recordingCount: number
  readonly bytes: number
  readonly sync: SearchSyncStateDto
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
  ...(summaryPreview === undefined ? {} : { summaryPreview }),
  ...(recording.folderId === undefined ? {} : { folderId: recording.folderId })
})

export const toFolderDto = (folder: Folder): FolderDto => ({
  id: folder.id,
  name: folder.name,
  ...(folder.parentId === undefined ? {} : { parentId: folder.parentId })
})

/** preload が contextBridge で公開する API の形。renderer はこれだけを見る。 */
export interface RendererApi {
  listRecordings(): Promise<RecordingDto[]>
  getRecording(id: string): Promise<RecordingDetailDto>
  startRecording(title?: string): Promise<RecordingDto>
  stopRecording(): Promise<RecordingDto>
  getTransportState(): Promise<TransportStateDto>
  /**
   * デスクトップ音声の入力レベル（0〜1）。録音中に UI が定期的に取りに来る。
   * マイクと違い main 側でしか観測できないため、ここだけ pull で渡す。
   */
  getSystemAudioLevel(): Promise<number>
  /** 無音の知らせに対して「録音を続ける」を選んだ。見張りを数え直させる。 */
  dismissSilenceAlert(): Promise<void>
  /** 録音を促す知らせに対して「今はしない」を選んだ。マイクが空くまで黙らせる。 */
  dismissStartAlert(): Promise<void>
  retryStep(recordingId: string, step: PipelineStep): Promise<RecordingDto>
  updateNote(recordingId: string, note: string): Promise<void>
  renameRecording(recordingId: string, title: string): Promise<RecordingDto>
  renameSpeaker(recordingId: string, speakerId: string, label: string): Promise<Speaker[]>
  deleteRecording(recordingId: string): Promise<void>
  /** 削除前の確認。ネイティブダイアログを出し、実行してよければ true を返す。 */
  confirmDeleteRecording(recordingId: string): Promise<boolean>
  revealRecording(recordingId: string): Promise<void>

  listFolders(): Promise<FolderDto[]>
  createFolder(params: { name: string; parentId?: string }): Promise<FolderDto>
  renameFolder(folderId: string, name: string): Promise<FolderDto>
  moveFolder(folderId: string, parentId?: string): Promise<void>
  deleteFolder(folderId: string): Promise<void>
  moveRecordingToFolder(recordingId: string, folderId?: string): Promise<RecordingDto>

  getSetupState(): Promise<SetupStateDto>
  getModelStatus(): Promise<ManagedAssetStatusDto[]>
  downloadModel(id: string): Promise<Settings>
  cancelModelDownload(id: string): Promise<void>
  deleteModel(id: string): Promise<Settings>
  /** 削除前の確認。ネイティブダイアログを出し、実行してよければ true を返す。 */
  confirmDeleteModel(id: string): Promise<boolean>
  updateSettings(patch: SettingsPatch): Promise<Settings>
  chooseStorageDir(): Promise<string | undefined>
  chooseFile(kind: 'whisper-model' | 'llm-model' | 'onnx-model'): Promise<string | undefined>

  /** レンダラーの AudioWorklet が集めたマイク PCM を main へ渡す。 */
  pushMicPcm(pcm: ArrayBuffer): void

  onProgress(listener: (event: ProgressEventDto) => void): () => void
  onRecordingsChanged(listener: () => void): () => void
  onFoldersChanged(listener: () => void): () => void
  onTransportChanged(listener: (state: TransportStateDto) => void): () => void
  onSilenceAlert(listener: (event: SilenceAlertDto) => void): () => void
  onStartAlert(listener: (event: StartAlertDto) => void): () => void
  onModelProgress(listener: (event: ModelProgressDto) => void): () => void
}

/** IPC チャンネル名。main と preload で共有し、綴りのずれを防ぐ。 */
export const IPC = {
  listRecordings: 'recordings:list',
  getRecording: 'recordings:get',
  startRecording: 'transport:start',
  stopRecording: 'transport:stop',
  getTransportState: 'transport:state',
  getSystemAudioLevel: 'transport:systemLevel',
  silenceAlert: 'transport:silenceAlert',
  dismissSilenceAlert: 'transport:dismissSilenceAlert',
  startAlert: 'transport:startAlert',
  dismissStartAlert: 'transport:dismissStartAlert',
  retryStep: 'pipeline:retry',
  updateNote: 'recordings:updateNote',
  renameRecording: 'recordings:rename',
  renameSpeaker: 'recordings:renameSpeaker',
  deleteRecording: 'recordings:delete',
  confirmDeleteRecording: 'recordings:confirmDelete',
  revealRecording: 'recordings:reveal',
  listFolders: 'folders:list',
  createFolder: 'folders:create',
  renameFolder: 'folders:rename',
  moveFolder: 'folders:move',
  deleteFolder: 'folders:delete',
  moveRecordingToFolder: 'recordings:moveFolder',
  foldersChanged: 'folders:changed',
  getSetupState: 'settings:setupState',
  getModelStatus: 'models:status',
  downloadModel: 'models:download',
  cancelModelDownload: 'models:cancel',
  deleteModel: 'models:delete',
  confirmDeleteModel: 'models:confirmDelete',
  modelProgress: 'models:progress',
  updateSettings: 'settings:update',
  chooseStorageDir: 'settings:chooseStorageDir',
  chooseFile: 'settings:chooseFile',
  pushMicPcm: 'transport:micPcm',
  progress: 'pipeline:progress',
  recordingsChanged: 'recordings:changed',
  transportChanged: 'transport:changed'
} as const
