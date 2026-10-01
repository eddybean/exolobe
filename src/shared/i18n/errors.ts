import {
  AppError,
  toMessage,
  type ErrorCode,
  type ErrorReason,
  type MemoryTask,
  type SettingsProblem
} from '@domain/errors'
import { SUGGESTED_IMPORT_FORMATS } from '@domain/AudioImport'
import { formatBytes } from '@domain/ModelCatalog'
import { SUPPORTED_SAMPLE_RATES, TRANSCRIPT_PLACEHOLDER } from '@domain/Settings'
import { appleIntelligenceUnavailableText } from './appleIntelligence'
import type { Locale } from './locale'
import { modelText } from './models'
import { stepLabel } from './steps'

/**
 * 失敗の理由を UI の言語の文言にする（ADR-043）。
 *
 * main（IPC で返すエラー・通知）と renderer（保存されたステップの失敗）の両方が引くので shared に置く。
 * コードごとに関数を持たせ、理由の種類を足したのに文言を書き忘れると型検査で落ちるようにしている。
 */
type ReasonMessages = {
  readonly [C in ErrorCode]: (reason: Extract<ErrorReason, { code: C }>) => string
}

/** 取り込めない形式を案内するときに挙げる形式。どの OS でも読めるものに限る（domain に 1 つだけ置く）。 */
const SUGGESTED_FORMATS = SUGGESTED_IMPORT_FORMATS

const MEMORY_TASKS: Readonly<Record<Locale, Readonly<Record<MemoryTask, string>>>> = {
  ja: {
    transcribe: '文字起こし',
    summarize: '要約',
    chat: 'チャットの回答',
    search: '意味検索',
    searchIndex: '意味検索の索引作成'
  },
  en: {
    transcribe: 'transcription',
    summarize: 'summarization',
    chat: 'the chat answer',
    search: 'semantic search',
    searchIndex: 'semantic search indexing'
  }
}

const SETTINGS_PROBLEMS: Readonly<Record<Locale, Readonly<Record<SettingsProblem, string>>>> = {
  ja: {
    sampleRate: `サンプルレートは ${SUPPORTED_SAMPLE_RATES.join(', ')} のいずれかを指定してください。`,
    bitrate: 'ビットレートは 1kbps 以上を指定してください。',
    silenceDuration: '無音を知らせるまでの時間は 1 分以上を指定してください。',
    startAlertDelay: '録音を促すまでの時間は 30 秒以上を指定してください。',
    maxSpeakers: '話者数の上限は 2 以上を指定してください。',
    voiceprintThreshold: '声紋の一致閾値は 0 より大きく 1 以下の値を指定してください。',
    clusteringThreshold: '話者を分ける近さは 0 より大きく 1 以下の値を指定してください。',
    appearance: 'テーマは「OS の設定に合わせる」「ライト」「ダーク」のいずれかを指定してください。',
    updateCheck: '更新の確認は「毎日」「毎週」「毎月」「確認しない」のいずれかを指定してください。',
    summarizationProvider: '要約のモデルは「Gemma」か「Apple Intelligence」を指定してください。',
    memoryProtection: 'メモリ保護は「保守的」「標準」「オフ」のいずれかを指定してください。',
    contextSize: '要約モデルのコンテキスト長は 1024 以上を指定してください。',
    promptPlaceholder: `要約プロンプトには文字起こしの差し込み位置 ${TRANSCRIPT_PLACEHOLDER} を含めてください。`,
    chatMaxRecordings: 'チャットで参照する録音の件数は 1〜30 の範囲で指定してください。'
  },
  en: {
    sampleRate: `Sample rate must be one of ${SUPPORTED_SAMPLE_RATES.join(', ')}.`,
    bitrate: 'Bitrate must be at least 1 kbps.',
    silenceDuration: 'The silence alert delay must be at least 1 minute.',
    startAlertDelay: 'The recording reminder delay must be at least 30 seconds.',
    maxSpeakers: 'The maximum number of speakers must be at least 2.',
    voiceprintThreshold: 'The voiceprint match threshold must be greater than 0 and at most 1.',
    clusteringThreshold: 'The speaker separation threshold must be greater than 0 and at most 1.',
    appearance: 'Theme must be Match System, Light, or Dark.',
    updateCheck: 'Update checks must be Daily, Weekly, Monthly, or Never.',
    summarizationProvider: 'The summarization model must be Gemma or Apple Intelligence.',
    memoryProtection: 'Memory protection must be Conservative, Standard, or Off.',
    contextSize: 'The summarization model context length must be at least 1024.',
    promptPlaceholder: `The summary prompt must contain ${TRANSCRIPT_PLACEHOLDER}, where the transcript is inserted.`,
    chatMaxRecordings: 'The number of recordings chat refers to must be between 1 and 30.'
  }
}

const SHERPA_MODELS = {
  ja: { segmentation: '話者分割モデル', embedding: '話者埋め込みモデル' },
  en: { segmentation: 'Speaker segmentation model', embedding: 'Speaker embedding model' }
} as const

const ja: ReasonMessages = {
  recordingNotFound: (r) => `録音が見つかりません: ${r.recordingId}`,
  alreadyRecording: () => 'すでに録音中です。',
  notRecording: () => '録音中ではありません。',
  storageNotConfigured: () => '保存先が設定されていません。設定画面から保存先を選んでください。',
  tooShortRecording: (r) => `録音時間が ${r.seconds} 秒しかありません。1 分未満の録音は処理しません。`,
  recordingDataMissing: () => '録音データが見つかりません。',
  storageNewerVersion: (r) => `${r.fileName} は新しい版の Exolobe で保存されています。アプリを更新してください。`,
  fileUnreadable: (r) => `ファイルを読み取れません: ${r.path}`,
  importNoExtension: (r) =>
    `「${r.fileName}」は拡張子が無いため音声形式を判別できませんでした。${SUGGESTED_FORMATS.join('・')} などの拡張子を付けてからお試しください。`,
  importUnreadableFormat: (r) =>
    `「${r.fileName}」は .${r.extension} 形式です。この形式の音声はまだ取り込めません。${SUGGESTED_FORMATS.join('・')} などに変換してからお試しください。`,
  importNotAudio: (r) =>
    `「${r.fileName}」は音声ファイルとして扱えません。取り込めるのは ${SUGGESTED_FORMATS.join('・')} などです。`,
  decodeFailed: (r) =>
    `「${r.fileName}」の音声を読み取れませんでした。ファイルが壊れているか、対応していない符号化方式かもしれません。`,
  folderNameRequired: () => 'フォルダ名を入力してください。',
  folderNotFound: () => 'フォルダが見つかりません。',
  parentFolderNotFound: () => '親フォルダが見つかりません。',
  folderMoveIntoSelf: () => '自分自身や子孫フォルダの下には移動できません。',
  titleRequired: () => 'タイトルを入力してください。',
  speakerNameRequired: () => '話者名を入力してください。',
  transcriptTextRequired: () => '本文を入力してください。',
  transcriptMissing: () => '文字起こしがまだありません。',
  transcriptChanged: () => '文字起こしが更新されています。画面を開き直してください。',
  transcriptEditBlocked: (r) => `${stepLabel(r.step, 'ja')}が終わるまでお待ちください。`,
  invalidSettings: (r) => r.problems.map((problem) => SETTINGS_PROBLEMS.ja[problem]).join('\n'),
  stepBlocked: (r) => `前のステップ（${stepLabel(r.blocker, 'ja')}）が失敗したため実行しませんでした。`,
  stepInterrupted: () => '処理の途中でアプリまたは処理プロセスが終了したため、完了しませんでした。再実行してください。',
  transcriptRequiredFirst: () => '文字起こしがまだありません。先に文字起こしを実行してください。',
  insufficientMemory: (r) =>
    `メモリが不足しているため${MEMORY_TASKS.ja[r.task]}を実行しませんでした` +
    `（必要 約${formatBytes(r.requiredBytes)} / 空き 約${formatBytes(r.availableBytes)}）。` +
    '他のアプリを終了してから再実行してください。' +
    '設定の「メモリ保護」で判定の厳しさを変えられます。',
  mixNoTracks: () => 'ミックスするトラックがありません。',
  mixSampleRateMismatch: (r) => `トラックのサンプルレートが一致しません: ${r.sampleRates.join(', ')}`,
  wavUnreadable: (r) => `WAV ファイルとして読み取れません: ${r.path}`,
  wavUnsupportedBits: (r) => `16bit PCM のみ対応しています（${r.bits}bit）: ${r.path}`,
  wavChunkMissing: (r) => `${r.chunk} チャンクが見つかりません: ${r.path}`,
  wavClosed: () => 'クローズ済みの WAV には書き込めません。',
  encodeFailed: (r) => `音声のエンコードに失敗しました: ${r.detail}`,
  transcriptionModelNotConfigured: () => '文字起こしモデルが設定されていません。設定画面でモデルを選んでください。',
  transcriptionOutputUnreadable: () => '文字起こし結果を読み取れませんでした。',
  whisperNotFound: (r) => `文字起こしに必要な ${r.binaryPath} が見つかりません。'npm run setup' を実行してください。`,
  whisperModelLoadFailed: () => 'whisper のモデルを読み込めませんでした。設定画面でモデルのパスを確認してください。',
  whisperVadUnsupported: (r) =>
    `${r.binaryPath} が無音区間の除外（VAD）に対応していません。whisper.cpp を v1.7.6 以降に更新するか、設定画面で無音区間の除外を無効にしてください。`,
  transcriptionFailed: (r) => `文字起こしに失敗しました: ${r.detail}`,
  diarizationModelNotConfigured: () =>
    '話者識別モデルが設定されていません。設定画面でモデルを選ぶか、話者識別を無効にしてください。',
  sherpaModelMissing: (r) =>
    `${SHERPA_MODELS.ja[r.model]}が見つかりません（${r.path}）。設定画面で取得し直すか、話者識別を無効にしてください。`,
  sherpaLoadFailed: (r) =>
    `sherpa-onnx を読み込めませんでした（${r.detail}）。` +
    (r.forDiarization ? '話者識別を無効にすると、自分と参加者の 2 話者で処理を続行できます。' : ''),
  diarizationSampleRate: (r) =>
    `話者識別モデルは ${r.modelRate} Hz の音声を前提としています` +
    `（この録音は ${r.recordingRate} Hz）。設定でサンプルレートを ` +
    `${r.modelRate} Hz にして録音し直すか、話者識別を無効にしてください。`,
  diarizationFailed: (r) => `話者識別に失敗しました: ${r.detail}`,
  speakerEmbeddingFailed: (r) => `声紋の抽出に失敗しました: ${r.detail}`,
  summaryModelNotConfigured: () => '要約モデルが設定されていません。設定画面でモデルを選んでください。',
  summaryModelLoadFailed: (r) => `要約モデルを読み込めませんでした（${r.path}）: ${r.detail}`,
  summaryTranscriptEmpty: () => '文字起こしが空のため要約できません。',
  appleIntelligenceUnavailable: (r) => appleIntelligenceUnavailableText(r.availability, 'ja'),
  appleIntelligenceRejected: () =>
    'Apple Intelligence の安全フィルタが要約を拒否しました。設定で要約のモデルを Gemma に切り替えると要約できます。',
  appleIntelligenceUnsupportedLanguage: () =>
    'Apple Intelligence はこの会議の言語に対応していません。設定で要約のモデルを Gemma に切り替えてください。',
  appleIntelligenceFailed: (r) => `Apple Intelligence での要約に失敗しました: ${r.detail}`,
  voiceLearningDiarizationDisabled: () => '話者識別が無効なため、この録音から声を覚えられません。',
  voiceLearningNoSpeakers: () => 'この録音は話者が分かれていないため、声を覚えられません。',
  voiceLearningUnavailable: () => '処理プロセスを使えないため、声を覚えられません。',
  chatModelNotConfigured: () => 'チャットに使うモデルが設定されていません。設定画面で要約モデルを取得してください。',
  chatModelLoadFailed: (r) => `チャット用のモデルを読み込めませんでした（${r.path}）: ${r.detail}`,
  searchModelMissing: () => '意味検索のモデルが未取得です。設定画面の「モデル」からダウンロードしてください。',
  searchModelLoadFailed: (r) => `意味検索のモデルを読み込めませんでした（${r.path}）: ${r.detail}`,
  modelBusyRecording: (r) =>
    `録音中はモデルを${r.action === 'delete' ? '削除' : '更新'}できません。録音を停止してから操作してください。`,
  modelBusyProcessing: (r) =>
    `処理中の録音があるためモデルを${r.action === 'delete' ? '削除' : '更新'}できません。完了してから操作してください。`,
  unknownModel: (r) => `不明なモデルです: ${r.id}`,
  downloadEmpty: () => 'ダウンロードの応答が空でした。',
  downloadAborted: () => 'ダウンロードを中止しました。',
  downloadFailed: (r) => `ダウンロードに失敗しました: ${r.detail}`,
  downloadCorrupted: () => 'ダウンロードしたファイルが壊れています。通信環境を確認してもう一度お試しください。',
  downloadNetwork: (r) => `ダウンロードに失敗しました: ${r.detail}。ネットワーク接続を確認してください。`,
  downloadHttp: (r) => `ダウンロードに失敗しました（${r.status} ${r.statusText}）。`,
  modelExtractMissing: (r) =>
    `モデルの取得に失敗しました（${modelText(r.assetId, 'ja').label}）。展開後のファイルが見つかりません。`,
  modelExtractFailed: (r) => `モデルの展開に失敗しました: ${r.detail}`,
  systemAudioBinary: (r) =>
    `システム音声の取得プログラムを起動できませんでした（${r.detail}）。` +
    'アプリの再インストールで解消しない場合は不具合の可能性があります。',
  systemAudioPermission: () =>
    'システム音声を取得できませんでした。「システム設定 > プライバシーとセキュリティ > ' +
    'オーディオ録音」でこのアプリを許可してください。',
  systemAudioCapture: (r) =>
    `システム音声を取り込めませんでした（${r.detail}）。Windows 10 バージョン 2004 以降で、` +
    '再生デバイスが有効になっているか確かめてください。'
}

const en: ReasonMessages = {
  recordingNotFound: (r) => `Recording not found: ${r.recordingId}`,
  alreadyRecording: () => 'Already recording.',
  notRecording: () => 'Not recording.',
  storageNotConfigured: () => 'No save location is set. Choose one in Settings.',
  tooShortRecording: (r) =>
    `The recording is only ${r.seconds} seconds long. Recordings under 1 minute are not processed.`,
  recordingDataMissing: () => 'The recording data could not be found.',
  storageNewerVersion: (r) => `${r.fileName} was saved by a newer version of Exolobe. Please update the app.`,
  fileUnreadable: (r) => `Cannot read the file: ${r.path}`,
  importNoExtension: (r) =>
    `“${r.fileName}” has no file extension, so its audio format could not be determined. Add an extension such as ${SUGGESTED_FORMATS.join(', ')} and try again.`,
  importUnreadableFormat: (r) =>
    `“${r.fileName}” is a .${r.extension} file. Audio in this format cannot be imported yet. Convert it to ${SUGGESTED_FORMATS.join(', ')} or similar and try again.`,
  importNotAudio: (r) =>
    `“${r.fileName}” cannot be handled as an audio file. Supported formats include ${SUGGESTED_FORMATS.join(', ')}.`,
  decodeFailed: (r) =>
    `Could not read the audio in “${r.fileName}”. The file may be damaged or use an unsupported encoding.`,
  folderNameRequired: () => 'Enter a folder name.',
  folderNotFound: () => 'Folder not found.',
  parentFolderNotFound: () => 'Parent folder not found.',
  folderMoveIntoSelf: () => 'A folder cannot be moved into itself or one of its subfolders.',
  titleRequired: () => 'Enter a title.',
  speakerNameRequired: () => 'Enter a speaker name.',
  transcriptTextRequired: () => 'Enter some text.',
  transcriptMissing: () => 'There is no transcript yet.',
  transcriptChanged: () => 'The transcript has been updated. Reopen this screen.',
  transcriptEditBlocked: (r) => `Please wait until ${stepLabel(r.step, 'en').toLowerCase()} finishes.`,
  invalidSettings: (r) => r.problems.map((problem) => SETTINGS_PROBLEMS.en[problem]).join('\n'),
  stepBlocked: (r) => `Skipped because an earlier step (${stepLabel(r.blocker, 'en')}) failed.`,
  stepInterrupted: () => 'The app or the processing process quit before this step finished. Run it again.',
  transcriptRequiredFirst: () => 'There is no transcript yet. Run transcription first.',
  insufficientMemory: (r) =>
    `Not enough memory to run ${MEMORY_TASKS.en[r.task]} ` +
    `(about ${formatBytes(r.requiredBytes)} needed, about ${formatBytes(r.availableBytes)} free). ` +
    'Quit other apps and try again. ' +
    'You can change how strict this check is with “Memory protection” in Settings.',
  mixNoTracks: () => 'There are no tracks to mix.',
  mixSampleRateMismatch: (r) => `The tracks have different sample rates: ${r.sampleRates.join(', ')}`,
  wavUnreadable: (r) => `Cannot read as a WAV file: ${r.path}`,
  wavUnsupportedBits: (r) => `Only 16-bit PCM is supported (${r.bits}-bit): ${r.path}`,
  wavChunkMissing: (r) => `${r.chunk} chunk not found: ${r.path}`,
  wavClosed: () => 'Cannot write to a closed WAV file.',
  encodeFailed: (r) => `Audio encoding failed: ${r.detail}`,
  transcriptionModelNotConfigured: () => 'No transcription model is set. Choose a model in Settings.',
  transcriptionOutputUnreadable: () => 'Could not read the transcription result.',
  whisperNotFound: (r) => `${r.binaryPath}, which transcription needs, was not found. Run 'npm run setup'.`,
  whisperModelLoadFailed: () => 'Could not load the whisper model. Check the model path in Settings.',
  whisperVadUnsupported: (r) =>
    `${r.binaryPath} does not support skipping silence (VAD). Update whisper.cpp to v1.7.6 or later, or turn off silence skipping in Settings.`,
  transcriptionFailed: (r) => `Transcription failed: ${r.detail}`,
  diarizationModelNotConfigured: () =>
    'No speaker identification model is set. Choose a model in Settings or turn off speaker identification.',
  sherpaModelMissing: (r) =>
    `${SHERPA_MODELS.en[r.model]} not found (${r.path}). Download it again in Settings or turn off speaker identification.`,
  sherpaLoadFailed: (r) =>
    `Could not load sherpa-onnx (${r.detail}).` +
    (r.forDiarization
      ? ' Turning off speaker identification lets processing continue with two speakers: you and the other side.'
      : ''),
  diarizationSampleRate: (r) =>
    `The speaker identification model expects ${r.modelRate} Hz audio ` +
    `(this recording is ${r.recordingRate} Hz). Set the sample rate to ${r.modelRate} Hz ` +
    'in Settings and record again, or turn off speaker identification.',
  diarizationFailed: (r) => `Speaker identification failed: ${r.detail}`,
  speakerEmbeddingFailed: (r) => `Voiceprint extraction failed: ${r.detail}`,
  summaryModelNotConfigured: () => 'No summarization model is set. Choose a model in Settings.',
  summaryModelLoadFailed: (r) => `Could not load the summarization model (${r.path}): ${r.detail}`,
  summaryTranscriptEmpty: () => 'The transcript is empty, so there is nothing to summarize.',
  appleIntelligenceUnavailable: (r) => appleIntelligenceUnavailableText(r.availability, 'en'),
  appleIntelligenceRejected: () =>
    'Apple Intelligence’s safety filter refused to summarize this. Switch the summarization model to Gemma in Settings to summarize it.',
  appleIntelligenceUnsupportedLanguage: () =>
    'Apple Intelligence does not support the language of this meeting. Switch the summarization model to Gemma in Settings.',
  appleIntelligenceFailed: (r) => `Summarizing with Apple Intelligence failed: ${r.detail}`,
  voiceLearningDiarizationDisabled: () =>
    'Speaker identification is off, so voices cannot be learned from this recording.',
  voiceLearningNoSpeakers: () => 'Speakers are not separated in this recording, so voices cannot be learned from it.',
  voiceLearningUnavailable: () => 'The processing process is unavailable, so voices cannot be learned.',
  chatModelNotConfigured: () => 'No model is set up for chat. Download the summarization model in Settings.',
  chatModelLoadFailed: (r) => `Could not load the chat model (${r.path}): ${r.detail}`,
  searchModelMissing: () => 'The semantic search model has not been downloaded. Download it from “Models” in Settings.',
  searchModelLoadFailed: (r) => `Could not load the semantic search model (${r.path}): ${r.detail}`,
  modelBusyRecording: (r) =>
    `Models cannot be ${r.action === 'delete' ? 'deleted' : 'updated'} while recording. Stop the recording first.`,
  modelBusyProcessing: (r) =>
    `Models cannot be ${r.action === 'delete' ? 'deleted' : 'updated'} while a recording is being processed. Wait until it finishes.`,
  unknownModel: (r) => `Unknown model: ${r.id}`,
  downloadEmpty: () => 'The download returned no data.',
  downloadAborted: () => 'Download canceled.',
  downloadFailed: (r) => `Download failed: ${r.detail}`,
  downloadCorrupted: () => 'The downloaded file is damaged. Check your connection and try again.',
  downloadNetwork: (r) => `Download failed: ${r.detail}. Check your network connection.`,
  downloadHttp: (r) => `Download failed (${r.status} ${r.statusText}).`,
  modelExtractMissing: (r) =>
    `Could not get the model (${modelText(r.assetId, 'en').label}). The extracted file was not found.`,
  modelExtractFailed: (r) => `Could not extract the model: ${r.detail}`,
  systemAudioBinary: (r) =>
    `Could not start the system audio capture program (${r.detail}). ` +
    'If reinstalling the app does not fix this, it may be a bug.',
  systemAudioPermission: () =>
    'Could not capture system audio. Allow this app in “System Settings > Privacy & Security > ' +
    'Screen & System Audio Recording”.',
  systemAudioCapture: (r) =>
    `Could not capture system audio (${r.detail}). Windows 10 version 2004 or later is required, ` +
    'and a playback device must be enabled.'
}

const MESSAGES: Readonly<Record<Locale, ReasonMessages>> = { ja, en }

/**
 * 理由を文言にする。知らないコード（新しい版が meta.json に保存した理由など）は undefined。
 * 呼び出し側は保存されていた生の文字列へ戻す。
 */
export const describeReason = (reason: ErrorReason, locale: Locale): string | undefined => {
  if (!isKnownCode(reason.code)) return undefined
  // コードと引数の型の対応は TypeScript が追えない（相関のある共用体）ので、ここだけ広げて呼ぶ。
  // 表の型（ReasonMessages）がコードごとの引数を保証している。
  const format = MESSAGES[locale][reason.code] as (r: ErrorReason) => string
  return format(reason)
}

/** 保存データから読んだ理由は、新しい版が足したコードかもしれない。 */
const isKnownCode = (code: string): code is ErrorCode => Object.hasOwn(ja, code)

/** 例外を利用者向けの文言にする。理由の無い例外（ネイティブ由来など）は元のメッセージのまま。 */
export const describeError = (error: unknown, locale: Locale): string => {
  if (error instanceof AppError) return describeReason(error.reason, locale) ?? error.message
  return toMessage(error)
}
