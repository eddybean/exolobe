import { describeError } from '@shared/i18n/errors'
import { FALLBACK_LOCALE, type Locale } from '@shared/i18n/locale'

/**
 * main プロセスの UI の言語と文言（ADR-043）。
 *
 * 言語は起動時に macOS の優先言語から一度だけ決め、アプリが動いている間は変えない。
 * メニュー・トレイ・通知・ダイアログを作り直す仕組みを持たずに済み、macOS の他のアプリと同じく
 * 言語を変えたら再起動で反映される。
 */
let current: Locale = FALLBACK_LOCALE

export const setAppLocale = (locale: Locale): void => {
  current = locale
}

export const appLocale = (): Locale => current

/** 例外を UI の言語の文言にする。IPC で renderer へ返す直前に使う。 */
export const describe = (error: unknown): string => describeError(error, current)

const ja = {
  menu: {
    recording: '録音',
    start: '録音を開始',
    stop: '録音を停止',
    showWindow: 'ウィンドウを表示',
    view: '表示',
    openDocs: 'ドキュメントを開く'
  },
  /**
   * Windows のメニューバー。macOS は役割のメニューを OS が訳すが、Windows では Electron の既定（英語）の
   * まま出るので、役割の項目にも名前を付ける。(&F) などは Alt キーで開くためのアクセスキー。
   */
  windowsMenu: {
    file: 'ファイル(&F)',
    recording: '録音(&R)',
    edit: '編集(&E)',
    view: '表示(&V)',
    window: 'ウィンドウ(&W)',
    help: 'ヘルプ(&H)',
    quit: '終了',
    undo: '元に戻す',
    redo: 'やり直し',
    cut: '切り取り',
    copy: 'コピー',
    paste: '貼り付け',
    selectAll: 'すべて選択',
    reload: '再読み込み',
    toggleDevTools: '開発者ツール',
    resetZoom: '実際のサイズ',
    zoomIn: '拡大',
    zoomOut: '縮小',
    togglefullscreen: '全画面表示',
    minimize: '最小化',
    close: '閉じる'
  },
  tray: {
    recording: (title: string) => `録音中: ${title}`,
    idle: '停止中',
    start: '録音を開始',
    stop: '録音を停止',
    showWindow: 'ウィンドウを表示',
    quit: '終了'
  },
  notification: {
    silenceTitle: '録音を続けていますか？',
    silenceBody: (minutes: number) =>
      `${minutes} 分以上、音が入っていません。会議が終わっているなら録音を停止してください。`,
    stop: '録音を停止',
    keepGoing: '続ける',
    startTitle: '録音していません',
    startBody: (message: string) => `${message}会議が始まっているなら録音を開始してください。`,
    start: '録音を開始',
    notNow: '今はしない',
    autoStartedTitle: '録音を開始しました',
    stopAndDiscard: '停止して破棄'
  },
  dialog: {
    delete: '削除',
    cancel: 'キャンセル',
    resummarizeMessage: (title: string) => `「${title}」を要約し直しますか？`,
    resummarizeDetail: '今の要約は新しい要約で置き換えられます。手で直した内容も失われ、元に戻せません。',
    resummarize: '再要約',
    deleteRecordingMessage: (title: string) => `「${title}」を削除しますか？`,
    deleteRecordingDetail: '音声・文字起こし・要約・メモがすべて削除されます。この操作は取り消せません。',
    deleteModelMessage: (label: string) => `「${label}」を削除しますか？`,
    deleteModelDetail: (size: string) => `もう一度使うには ${size} のダウンロードが必要になります。`,
    deleteSearchIndexMessage: '意味検索のインデックスを削除しますか？',
    deleteSearchIndexSize: (count: number, size: string) => `${count} 件分、約 ${size} が削除されます。`,
    deleteSearchIndexKeeps: '録音・文字起こし・要約・メモは削除されません。',
    deleteSearchIndexRebuild: '意味検索が有効な間は、次に録音を処理したときなどに作り直されます。',
    forgetVoiceMessage: (name: string) => `「${name}」の声を忘れますか？`,
    forgetVoiceDetail: [
      'この声で自動的に名前が入らなくなります。',
      '録音と、すでに付けた話者名はそのまま残ります。',
      'もう一度どこかの録音で同じ名前を付ければ、また覚えます。'
    ],
    forget: '忘れる',
    forgetAllMessage: '覚えた声をすべて忘れますか？',
    forgetAllCount: (count: number) => `${count} 人分の声が削除されます。`,
    forgetAllKeeps: '録音と、すでに付けた話者名はそのまま残ります。',
    forgetAll: 'すべて忘れる',
    importTitle: '取り込む音声ファイルを選択',
    importButton: '取り込む',
    audioFiles: '音声ファイル',
    storageTitle: '録音の保存先を選択',
    storageButton: 'この場所に保存',
    modelTitle: 'モデルファイルを選択',
    whisperModel: 'whisper モデル',
    ggufModel: 'GGUF モデル',
    onnxModel: 'ONNX モデル'
  },
  error: {
    probeInProgressStart: 'テスト録音の途中です。数秒待ってから録音を始めてください。',
    probeInProgress: 'テスト録音の途中です。',
    probeWhileRecording: '録音中はテストできません。録音を止めてからお試しください。',
    searchDisabled: '意味検索が無効です。設定画面で有効にしてください。',
    chatWaitForProcessing: '録音や処理が終わるまで待ってください。',
    chatBusy: '録音の処理中です。終わってからもう一度お試しください。',
    chatDisabled: 'チャットが無効です。設定画面で有効にしてください。',
    tooManyImports: (max: number) => `一度に取り込めるのは ${max} 件までです。`,
    pipelineNoResult: '処理の結果を受け取れませんでした。',
    pipelineExited: '処理プロセスが終了しました。詳細画面から失敗したステップを再実行してください。',
    searchExited: '検索用のプロセスが終了しました。もう一度お試しください。',
    chatExited: 'チャット用のプロセスが終了しました。もう一度お試しください。'
  }
}

type MainMessages = typeof ja

const en: MainMessages = {
  menu: {
    recording: 'Recording',
    start: 'Start Recording',
    stop: 'Stop Recording',
    showWindow: 'Show Window',
    view: 'View',
    openDocs: 'Open Documentation'
  },
  windowsMenu: {
    file: '&File',
    recording: '&Recording',
    edit: '&Edit',
    view: '&View',
    window: '&Window',
    help: '&Help',
    quit: 'Exit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    reload: 'Reload',
    toggleDevTools: 'Developer Tools',
    resetZoom: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    togglefullscreen: 'Full Screen',
    minimize: 'Minimize',
    close: 'Close'
  },
  tray: {
    recording: (title: string) => `Recording: ${title}`,
    idle: 'Not Recording',
    start: 'Start Recording',
    stop: 'Stop Recording',
    showWindow: 'Show Window',
    quit: 'Quit'
  },
  notification: {
    silenceTitle: 'Still recording?',
    silenceBody: (minutes: number) =>
      `No sound for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} or more. If the meeting is over, stop recording.`,
    stop: 'Stop Recording',
    keepGoing: 'Keep Recording',
    startTitle: 'Not recording',
    startBody: (message: string) => `${message} If a meeting has started, start recording.`,
    start: 'Start Recording',
    notNow: 'Not Now',
    autoStartedTitle: 'Recording started',
    stopAndDiscard: 'Stop and Discard'
  },
  dialog: {
    delete: 'Delete',
    cancel: 'Cancel',
    resummarizeMessage: (title: string) => `Summarize “${title}” again?`,
    resummarizeDetail:
      'The current summary will be replaced by a new one. Any edits you made will be lost and cannot be restored.',
    resummarize: 'Summarize Again',
    deleteRecordingMessage: (title: string) => `Delete “${title}”?`,
    deleteRecordingDetail: 'The audio, transcript, summary, and notes will all be deleted. This cannot be undone.',
    deleteModelMessage: (label: string) => `Delete “${label}”?`,
    deleteModelDetail: (size: string) => `To use it again, you will need to download ${size}.`,
    deleteSearchIndexMessage: 'Delete the semantic search index?',
    deleteSearchIndexSize: (count: number, size: string) =>
      `Index data for ${count} ${count === 1 ? 'recording' : 'recordings'} (about ${size}) will be deleted.`,
    deleteSearchIndexKeeps: 'Recordings, transcripts, summaries, and notes are not deleted.',
    deleteSearchIndexRebuild:
      'While semantic search is on, the index is rebuilt, for example the next time a recording is processed.',
    forgetVoiceMessage: (name: string) => `Forget the voice of “${name}”?`,
    forgetVoiceDetail: [
      'This name will no longer be filled in automatically for this voice.',
      'Recordings and speaker names you already set are kept.',
      'Give the same name in any recording again and the voice will be learned again.'
    ],
    forget: 'Forget',
    forgetAllMessage: 'Forget all learned voices?',
    forgetAllCount: (count: number) => `Voices of ${count} ${count === 1 ? 'person' : 'people'} will be deleted.`,
    forgetAllKeeps: 'Recordings and speaker names you already set are kept.',
    forgetAll: 'Forget All',
    importTitle: 'Choose Audio Files to Import',
    importButton: 'Import',
    audioFiles: 'Audio Files',
    storageTitle: 'Choose Where to Save Recordings',
    storageButton: 'Save Here',
    modelTitle: 'Choose a Model File',
    whisperModel: 'whisper Model',
    ggufModel: 'GGUF Model',
    onnxModel: 'ONNX Model'
  },
  error: {
    probeInProgressStart: 'A test recording is in progress. Wait a few seconds, then start recording.',
    probeInProgress: 'A test recording is in progress.',
    probeWhileRecording: 'You cannot run a test while recording. Stop recording and try again.',
    searchDisabled: 'Semantic search is off. Turn it on in Settings.',
    chatWaitForProcessing: 'Wait until recording and processing finish.',
    chatBusy: 'A recording is being processed. Try again when it finishes.',
    chatDisabled: 'Chat is off. Turn it on in Settings.',
    tooManyImports: (max: number) => `You can import up to ${max} files at a time.`,
    pipelineNoResult: 'Could not receive the processing result.',
    pipelineExited: 'The processing process quit. Run the failed steps again from the recording details.',
    searchExited: 'The search process quit. Please try again.',
    chatExited: 'The chat process quit. Please try again.'
  }
}

const MESSAGES: Readonly<Record<Locale, MainMessages>> = { ja, en }

/** 今の UI の言語の文言。 */
export const text = (): MainMessages => MESSAGES[current]
