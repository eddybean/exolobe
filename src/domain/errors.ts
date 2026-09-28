import type { PipelineStep } from './Recording'

/** メモリの見積もりで断る処理。利用者に見せる名前は表示側が引く。 */
export type MemoryTask = 'transcribe' | 'summarize' | 'chat' | 'search' | 'searchIndex'

/** 設定の検証で見つかった問題。 */
export type SettingsProblem =
  | 'sampleRate'
  | 'bitrate'
  | 'silenceDuration'
  | 'startAlertDelay'
  | 'maxSpeakers'
  | 'voiceprintThreshold'
  | 'clusteringThreshold'
  | 'memoryProtection'
  | 'contextSize'
  | 'promptPlaceholder'
  | 'chatMaxRecordings'

/** 話者識別・声紋抽出が読むモデル。 */
export type SherpaModel = 'segmentation' | 'embedding'

/**
 * 利用者に伝える失敗の理由（ADR-043）。
 *
 * domain は文言を持たず、何が起きたかと表示に要る値だけを返す。文言は表示する側
 * （main のハンドラ・renderer）が UI の言語で引く。ステップの失敗としても保存されるので
 * （meta.json）、値はすべて JSON にそのまま書けるものに限る。
 */
export type ErrorReason =
  // 録音と保存先
  | { readonly code: 'recordingNotFound'; readonly recordingId: string }
  | { readonly code: 'alreadyRecording' }
  | { readonly code: 'notRecording' }
  | { readonly code: 'storageNotConfigured' }
  | { readonly code: 'tooShortRecording'; readonly seconds: number }
  | { readonly code: 'recordingDataMissing' }
  | { readonly code: 'storageNewerVersion'; readonly fileName: string }
  // 取り込み
  | { readonly code: 'fileUnreadable'; readonly path: string }
  | { readonly code: 'importNoExtension'; readonly fileName: string }
  | {
      readonly code: 'importUnreadableFormat'
      readonly fileName: string
      readonly extension: string
    }
  | { readonly code: 'importNotAudio'; readonly fileName: string }
  | { readonly code: 'decodeFailed'; readonly fileName: string }
  // フォルダ・ライブラリの編集
  | { readonly code: 'folderNameRequired' }
  | { readonly code: 'folderNotFound' }
  | { readonly code: 'parentFolderNotFound' }
  | { readonly code: 'folderMoveIntoSelf' }
  | { readonly code: 'titleRequired' }
  | { readonly code: 'speakerNameRequired' }
  | { readonly code: 'transcriptTextRequired' }
  | { readonly code: 'transcriptMissing' }
  | { readonly code: 'transcriptChanged' }
  | { readonly code: 'transcriptEditBlocked'; readonly step: 'transcribe' | 'diarize' }
  | { readonly code: 'invalidSettings'; readonly problems: readonly SettingsProblem[] }
  // パイプライン
  | { readonly code: 'stepBlocked'; readonly blocker: PipelineStep }
  | { readonly code: 'stepInterrupted' }
  | { readonly code: 'transcriptRequiredFirst' }
  | {
      readonly code: 'insufficientMemory'
      readonly task: MemoryTask
      readonly requiredBytes: number
      readonly availableBytes: number
    }
  | { readonly code: 'mixNoTracks' }
  | { readonly code: 'mixSampleRateMismatch'; readonly sampleRates: readonly number[] }
  | { readonly code: 'wavUnreadable'; readonly path: string }
  | { readonly code: 'wavUnsupportedBits'; readonly bits: number; readonly path: string }
  | { readonly code: 'wavChunkMissing'; readonly chunk: string; readonly path: string }
  | { readonly code: 'wavClosed' }
  | { readonly code: 'encodeFailed'; readonly detail: string }
  | { readonly code: 'transcriptionModelNotConfigured' }
  | { readonly code: 'transcriptionOutputUnreadable' }
  | { readonly code: 'whisperNotFound'; readonly binaryPath: string }
  | { readonly code: 'whisperModelLoadFailed' }
  | { readonly code: 'whisperVadUnsupported'; readonly binaryPath: string }
  | { readonly code: 'transcriptionFailed'; readonly detail: string }
  | { readonly code: 'diarizationModelNotConfigured' }
  | { readonly code: 'sherpaModelMissing'; readonly model: SherpaModel; readonly path: string }
  | { readonly code: 'sherpaLoadFailed'; readonly detail: string; readonly forDiarization: boolean }
  | {
      readonly code: 'diarizationSampleRate'
      readonly modelRate: number
      readonly recordingRate: number
    }
  | { readonly code: 'diarizationFailed'; readonly detail: string }
  | { readonly code: 'speakerEmbeddingFailed'; readonly detail: string }
  | { readonly code: 'summaryModelNotConfigured' }
  | { readonly code: 'summaryModelLoadFailed'; readonly path: string; readonly detail: string }
  | { readonly code: 'summaryTranscriptEmpty' }
  // 声を覚える
  | { readonly code: 'voiceLearningDiarizationDisabled' }
  | { readonly code: 'voiceLearningNoSpeakers' }
  | { readonly code: 'voiceLearningUnavailable' }
  // チャット・意味検索
  | { readonly code: 'chatModelNotConfigured' }
  | { readonly code: 'chatModelLoadFailed'; readonly path: string; readonly detail: string }
  | { readonly code: 'searchModelMissing' }
  | { readonly code: 'searchModelLoadFailed'; readonly path: string; readonly detail: string }
  // モデルの取得
  | { readonly code: 'modelBusyRecording'; readonly action: 'delete' | 'update' }
  | { readonly code: 'modelBusyProcessing'; readonly action: 'delete' | 'update' }
  | { readonly code: 'unknownModel'; readonly id: string }
  | { readonly code: 'downloadEmpty' }
  | { readonly code: 'downloadAborted' }
  | { readonly code: 'downloadFailed'; readonly detail: string }
  | { readonly code: 'downloadCorrupted' }
  | { readonly code: 'downloadNetwork'; readonly detail: string }
  | { readonly code: 'downloadHttp'; readonly status: number; readonly statusText: string }
  | { readonly code: 'modelExtractMissing'; readonly assetId: string }
  | { readonly code: 'modelExtractFailed'; readonly detail: string }
  // システム音声
  | { readonly code: 'systemAudioBinary'; readonly detail: string }
  | { readonly code: 'systemAudioPermission' }

export type ErrorCode = ErrorReason['code']

/**
 * 利用者に理由を伝えられるエラーの基底。
 *
 * message には理由のコードだけを入れる。文言を持たせると UI の言語を domain が知ることになり、
 * ログにも利用者の言語が混ざる。表示は reason から引く。
 */
export class AppError extends Error {
  constructor(
    readonly reason: ErrorReason,
    options?: { cause?: unknown }
  ) {
    super(reason.code, options as ErrorOptions)
    this.name = new.target.name
  }
}

/** 設定不足など、利用者の操作で解消できる状態。 */
export class ConfigurationError extends AppError {}

/** 録音の開始・停止が現在の状態では行えない。 */
export class RecordingStateError extends AppError {}

/** 指定された録音が存在しない。 */
export class RecordingNotFoundError extends AppError {
  constructor(readonly recordingId: string) {
    super({ code: 'recordingNotFound', recordingId })
  }
}

/** 使用中のモデルを消そうとした。録音や処理が終われば解消する。 */
export class ModelInUseError extends AppError {}

/** パイプラインの 1 ステップが失敗した。 */
export class PipelineStepError extends AppError {}

/** 取り込もうとした音声ファイルの形式を扱えない。 */
export class UnsupportedAudioFormatError extends AppError {}

/**
 * 中身のある会議として扱えないほど短い。
 *
 * 録音では停止時点で録音が既に存在するため全ステップを失敗として記録するしかないが、
 * 取り込みは利用者が選んだ直後なので、録音を作る前にこれを投げて理由だけを返す。
 */
export class TooShortRecordingError extends AppError {}

/** 例外が理由を持っていれば返す。ネイティブ由来など、理由の無い失敗は undefined。 */
export const reasonOf = (error: unknown): ErrorReason | undefined =>
  error instanceof AppError ? error.reason : undefined

/**
 * 例外値から生のメッセージを取り出す。catch した unknown を安全に扱う。
 *
 * AppError ではコードが返る。利用者に見せる文言が要るときは表示側で reason から引くこと。
 */
export const toMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}
