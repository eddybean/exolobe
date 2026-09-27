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

/** マイクの許可の状態。macOS（systemPreferences.getMediaAccessStatus）の値そのまま。 */
export type MicPermissionDto = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

/** 「システム設定を開く」で開く画面の種類。 */
export type PrivacyPaneDto = 'microphone' | 'system-audio'

/** main から renderer へ回す録音の操作。 */
export type TransportRequestDto = 'start' | 'stop'

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
  /** 手元のファイルが、このアプリの版が想定する配布物と違う。 */
  readonly updateAvailable: boolean
  readonly path?: string
}

/** 取り込めなかった 1 件。部分失敗を黙って捨てないために理由まで持つ。 */
export interface ImportFailureDto {
  readonly fileName: string
  readonly reason: string
}

export interface ImportAudioResultDto {
  /** 取り込めた録音。一覧そのものは recordingsChanged で更新される。 */
  readonly imported: readonly RecordingDto[]
  readonly failed: readonly ImportFailureDto[]
}

/** 変換の進み具合。長い音声の変換中に UI が固まって見えないようにする。 */
export interface ImportProgressDto {
  readonly done: number
  readonly total: number
  /** いま変換しているファイル名。全件終わったら空。 */
  readonly fileName: string
}

export interface ProgressEventDto {
  readonly recordingId: string
  readonly step: PipelineStep
  readonly status: 'running' | 'done' | 'failed'
  readonly error?: string
  /** running の途中経過（0〜1）。割合を出せるステップ（いまは文字起こし）だけが付ける。 */
  readonly fraction?: number
}

/** 意味検索の 1 件の結果。関連度の高い順に並ぶ。 */
export interface SearchHitDto {
  readonly recordingId: string
  readonly title: string
  /** ISO 8601 文字列。 */
  readonly startedAt: string
  readonly score: number
  readonly source: 'summary' | 'note' | 'transcript'
  /** 当たった箇所の抜粋。なぜ当たったのかを利用者が確かめられるようにする。 */
  readonly excerpt: string
  /** 文字起こしで当たった場合の、該当区間の開始時刻。 */
  readonly startMs?: number
}

/** 抜粋の中でハイライトする位置。start は抜粋の先頭からの UTF-16 オフセット。 */
export interface HighlightRangeDto {
  readonly start: number
  readonly length: number
}

/** 文字起こし本文のキーワード検索の 1 件。新しい録音から順に並ぶ。 */
export interface TranscriptHitDto {
  readonly recordingId: string
  readonly title: string
  /** ISO 8601 文字列。 */
  readonly startedAt: string
  /** 録音開始からの相対ミリ秒。詳細画面はここへ飛ぶ。 */
  readonly startMs: number
  readonly speakerLabel: string
  readonly excerpt: string
  readonly ranges: readonly HighlightRangeDto[]
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

/** チャットの 1 ターン。system は渡さない（問いのたびに main 側で作り直す）。 */
export interface ChatTurnDto {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

/** 回答の根拠にした録音。答えの中の [1] [2] と同じ並び。 */
export interface ChatCitationDto {
  readonly recordingId: string
  readonly title: string
  /** ISO 8601 文字列。 */
  readonly startedAt: string
  readonly source: 'summary' | 'transcript'
  /** 文字起こしを載せた場合の、その範囲の先頭時刻。 */
  readonly startMs?: number
  /** 長さの都合で途中までしか載せられなかったか。 */
  readonly truncated: boolean
}

export interface ChatAnswerDto {
  readonly text: string
  readonly citations: readonly ChatCitationDto[]
  /** 「先週（08/31〜09/06）の 3 件」。何を見て答えたかを利用者に示す。 */
  readonly scopeLabel?: string
  readonly usedTranscript: boolean
  readonly droppedCount: number
  /** 生成の上限に達して書ききれなかったか。 */
  readonly truncated: boolean
}

/** 生成中の断片。requestId で宛先のメッセージを決める。 */
export interface ChatChunkDto {
  readonly requestId: string
  readonly text: string
}

/**
 * 生成の終わり。
 *
 * 成功も失敗もここで受ける。途中まで流した後に別のチャンネルで失敗が届くと、
 * 画面側の状態遷移が二手に分かれて取りこぼしやすくなる。
 */
export interface ChatDoneDto {
  readonly requestId: string
  readonly text: string
  readonly citations: readonly ChatCitationDto[]
  readonly scopeLabel?: string
  readonly droppedCount: number
  /** 生成の上限に達して書ききれなかったか。 */
  readonly truncated: boolean
  /** 利用者が途中で止めたか。止めた場合も、そこまでの本文は残す。 */
  readonly aborted: boolean
  readonly error?: string
}

export interface ChatAvailabilityDto {
  readonly enabled: boolean
  readonly modelInstalled: boolean
  /** 話題語での絞り込みが効くか。無くても期間だけで答えられる。 */
  readonly semanticSearchAvailable: boolean
  /** 今は使えない理由。空なら使える。 */
  readonly busyReason?: string
}

/**
 * 声紋帳の 1 件。ベクトルは渡さない（画面が使わないうえ、境界を越える意味が無い）。
 */
export interface VoiceprintDto {
  readonly name: string
  /** 学習に使った話者の数（＝この名前を付けた録音の数）。 */
  readonly samples: number
  /** ISO 文字列。境界を越えるのは DTO だけなので Date は渡さない。 */
  readonly updatedAt: string
}

/**
 * 話者に付けた名前を声紋として覚えられたか。
 *
 * 覚える処理は名前の反映とは別に裏で走るため、結果は後から届く。覚えられなかった
 * ことを黙って捨てない ―― 利用者から見れば「設定の『覚えた声』に何も増えない」
 * という形でしか現れず、原因にたどり着けない。
 */
export interface VoiceLearnedDto {
  readonly recordingId: string
  readonly speakerId: string
  readonly label: string
  readonly status: 'remembered' | 'skipped-self' | 'unavailable' | 'failed'
  /** `failed` のときの理由。利用者に見せる文面。 */
  readonly message?: string
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
  /**
   * main に置かれた録音の開始・停止の依頼を受け取る（受け取ったら消える）。
   * メニューやショートカットは main で受けるが、マイクを取れるのは renderer だけなので、
   * 実際の開始・停止は renderer が自分の手順で行う。
   */
  takeTransportRequest(): Promise<TransportRequestDto | undefined>
  /** マイクの許可の状態。システム設定から戻ってきたときにも読み直す。 */
  getMicPermission(): Promise<MicPermissionDto>
  /** まだ聞かれていなければ、マイクの許可を求める。許可されたかを返す。 */
  requestMicPermission(): Promise<boolean>
  /** プライバシーとセキュリティの該当する画面を開く。 */
  openPrivacySettings(pane: PrivacyPaneDto): Promise<void>
  /**
   * テスト録音のうちシステム音声の側。録音とは別に短い間だけ取り込み、届いた音の
   * 最大の大きさ（0〜1）を返す。録音中は断る。
   */
  probeSystemAudio(durationMs: number): Promise<number>
  retryStep(recordingId: string, step: PipelineStep): Promise<RecordingDto>

  /** 手元の音声ファイルを取り込み、文字起こし以降を走らせる。 */
  importAudioFiles(filePaths: readonly string[]): Promise<ImportAudioResultDto>
  /** ネイティブのファイル選択を出してそのまま取り込む。キャンセルなら両方空。 */
  chooseAudioFilesToImport(): Promise<ImportAudioResultDto>
  /**
   * ドロップされた File の実パス。
   * Electron 32 以降 File.path は無くなったため、webUtils を持つ preload に頼む。
   */
  pathForFile(file: File): string
  onImportProgress(listener: (event: ImportProgressDto) => void): () => void
  updateNote(recordingId: string, note: string): Promise<void>
  /** 手で直した要約を保存する。再要約すれば上書きされる。 */
  updateSummary(recordingId: string, summary: string): Promise<void>
  /** 再要約の前の確認。今の要約が置き換わるので、実行してよければ true を返す。 */
  confirmResummarize(recordingId: string): Promise<boolean>
  renameRecording(recordingId: string, title: string): Promise<RecordingDto>
  renameSpeaker(recordingId: string, speakerId: string, label: string): Promise<Speaker[]>
  /**
   * 1 セグメントの本文を直す。セグメントは id を持たないので、画面が見ていた
   * 位置と開始時刻の組で指す（食い違えば文字起こしが作り直されたとみなして拒否される）。
   */
  editSegmentText(
    recordingId: string,
    segment: { index: number; startMs: number },
    text: string
  ): Promise<TranscriptSegment[]>
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
  /** 進捗と結果は downloadModel と同じく modelProgress で届く。 */
  updateModel(id: string): Promise<Settings>
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
  /** 録音の開始・停止の依頼が置かれた。中身は takeTransportRequest で受け取る。 */
  onTransportRequested(listener: () => void): () => void
  onModelProgress(listener: (event: ModelProgressDto) => void): () => void
  /** 話者名を声紋として覚えた（あるいは覚えられなかった）ことの通知。 */
  onVoiceLearned(listener: (event: VoiceLearnedDto) => void): () => void

  /** 自然文のクエリで録音を探す。意味検索が有効でモデルがある場合だけ使える。 */
  searchRecordings(query: string): Promise<SearchHitDto[]>
  /** 文字起こし本文のキーワード検索。推論を使わないので意味検索が無効でも動く。 */
  searchTranscripts(query: string): Promise<TranscriptHitDto[]>
  getSearchIndexStatus(): Promise<SearchIndexStatusDto>
  /** 索引の削除前の確認。ネイティブダイアログを出し、実行してよければ true を返す。 */
  confirmClearSearchIndex(): Promise<boolean>
  clearSearchIndex(): Promise<SearchIndexStatusDto>
  onSearchIndexChanged(listener: (state: SearchSyncStateDto) => void): () => void

  /**
   * ライブラリ全体へ自然文で問いかける。
   *
   * 答えは chat:chunk / chat:done で届くので、この呼び出しの戻り値は待たない。
   */
  askChat(params: {
    requestId: string
    question: string
    history: readonly ChatTurnDto[]
  }): Promise<void>
  cancelChat(requestId: string): Promise<void>
  getChatAvailability(): Promise<ChatAvailabilityDto>
  onChatChunk(listener: (event: ChatChunkDto) => void): () => void
  onChatDone(listener: (event: ChatDoneDto) => void): () => void

  /** 話者名の自動適用に使う声紋帳。 */
  listVoiceprints(): Promise<VoiceprintDto[]>
  /** 削除前の確認。ネイティブダイアログを出し、実行してよければ true を返す。 */
  confirmRemoveVoiceprint(name: string): Promise<boolean>
  removeVoiceprint(name: string): Promise<VoiceprintDto[]>
  confirmClearVoiceprints(): Promise<boolean>
  clearVoiceprints(): Promise<VoiceprintDto[]>
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
  takeTransportRequest: 'transport:takeRequest',
  getMicPermission: 'permissions:mic',
  requestMicPermission: 'permissions:requestMic',
  openPrivacySettings: 'permissions:openSettings',
  probeSystemAudio: 'permissions:probeSystemAudio',
  transportRequested: 'transport:requested',
  retryStep: 'pipeline:retry',
  importAudioFiles: 'recordings:import',
  chooseAudioFilesToImport: 'recordings:chooseImport',
  importProgress: 'recordings:importProgress',
  updateNote: 'recordings:updateNote',
  updateSummary: 'recordings:updateSummary',
  confirmResummarize: 'recordings:confirmResummarize',
  renameRecording: 'recordings:rename',
  renameSpeaker: 'recordings:renameSpeaker',
  editSegmentText: 'recordings:editSegmentText',
  voiceLearned: 'recordings:voiceLearned',
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
  updateModel: 'models:update',
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
  transportChanged: 'transport:changed',
  searchRecordings: 'search:query',
  searchTranscripts: 'search:transcripts',
  getSearchIndexStatus: 'search:status',
  confirmClearSearchIndex: 'search:confirmClear',
  clearSearchIndex: 'search:clear',
  searchIndexChanged: 'search:changed',
  askChat: 'chat:ask',
  cancelChat: 'chat:cancel',
  getChatAvailability: 'chat:availability',
  chatChunk: 'chat:chunk',
  chatDone: 'chat:done',
  listVoiceprints: 'voiceprints:list',
  confirmRemoveVoiceprint: 'voiceprints:confirmRemove',
  removeVoiceprint: 'voiceprints:remove',
  confirmClearVoiceprints: 'voiceprints:confirmClear',
  clearVoiceprints: 'voiceprints:clear'
} as const
