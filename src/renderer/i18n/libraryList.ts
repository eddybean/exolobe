import { intlLocale, localized } from './locale'

/**
 * ライブラリのサイドバー（フォルダ・録音の一覧・検索）の文言。
 *
 * 同名の i18n/library.ts は録音詳細（音声プレビュー・声紋・声の学習）の文言に
 * 使われているため、こちらは別名にして衝突を避けている。
 */

const ja = {
  libraryTitle: 'ライブラリ',
  importAudio: '音声ファイルを取り込む',
  searchPlaceholderSemantic: '例: 天気の話をした会議（Enter で検索）',
  searchPlaceholderKeyword: 'タイトル・要約・本文で絞り込む',
  searchModeLabel: '検索の方法',
  keywordMode: 'キーワード',
  semanticMode: '意味',
  semanticModeHint: '文章の意味で探します。例:「天気の話をした会議」',
  foldersHeading: 'フォルダ',
  newFolder: '新規フォルダ',
  createSubfolder: '子フォルダを作成',
  renameFolder: '名前を変更',
  deleteFolder: '削除',
  searchingAllFolders: 'すべてのフォルダから探しています',
  noMatchingRecordings: '一致する録音がありません。',
  noRecordingsInFolder: 'このフォルダに録音はありません。録音を上のフォルダへドラッグすると移せます。',
  noRecordingsYetPrefix: '録音はまだありません。下の「録音」ボタンで開始するか、',
  noRecordingsYetLink: '音声ファイルを取り込め',
  noRecordingsYetSuffix: 'ます。',
  folderNamePlaceholder: 'フォルダ名',
  cancel: 'キャンセル',
  renameFolderTitle: 'フォルダの名前を変更',
  createSubfolderTitle: '子フォルダを作成',
  newFolderTitle: '新規フォルダ',
  renameSubmit: '変更',
  createSubmit: '作成',
  searchingTranscript: '本文を検索中…',
  transcriptHitsHeading: (count: number) => `本文に一致（${count} 件）`,
  semanticSearching: '検索しています…',
  semanticNoHits: '近い内容の録音が見つかりませんでした。言い方を変えて試してください。',
  /** 一覧の 2 行目などで、複数の断片を並べるときの区切り。 */
  metaSeparator: ' ・ ',
  joinMeta: (...parts: readonly string[]): string => parts.join(' ・ '),
  allFolders: 'すべて',
  unfiledFolder: '未分類',
  paneAriaLabel: 'ライブラリの幅（ダブルクリックで元に戻す）',
  paneTitle: 'ドラッグで幅を変更・ダブルクリックで元に戻す',
  // library/rows.ts
  today: '今日',
  yesterday: '昨日',
  thisWeek: '今週',
  thisMonth: '今月',
  monthHeading: (date: Date): string => `${date.getMonth() + 1}月`,
  yearMonthHeading: (date: Date): string => `${date.getFullYear()}年${date.getMonth() + 1}月`,
  underOneMinute: '1分未満',
  minutes: (value: number): string => `${value}分`,
  hours: (value: number): string => `${value}時間`,
  hoursMinutes: (hours: number, minutes: number): string => `${hours}時間${minutes}分`,
  rowDateTime: (date: Date, time: string): string => {
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'] as const
    return `${date.getMonth() + 1}月${date.getDate()}日(${weekdays[date.getDay()]}) ${time}`
  },
  // library/fileDrop.ts
  importFailedOne: (fileName: string, reason: string): string =>
    `「${fileName}」を取り込めませんでした。${reason}`,
  importFailedMany: (count: number, fileNames: readonly string[]): string =>
    `${count} 件を取り込めませんでした: ${fileNames.join('、')}`,
  // library/semanticSearch.ts
  sourceSummary: '要約',
  sourceNote: 'メモ',
  sourceTranscript: '文字起こし',
  searchModelMissing: '上の「モデル」から意味検索モデルをダウンロードしてください',
  indexChecking: 'インデックスを確認中…',
  indexBuilding: (done: number, total: number): string => `インデックスを作成中（${done} / ${total} 件）`,
  indexWaiting: '録音の処理が終わってからインデックスを作成します',
  indexError: (message: string): string => `インデックスを作成できませんでした: ${message}`,
  indexSummary: (recordingCount: number, indexedCount: number, bytes: string): string =>
    `${recordingCount} 件中 ${indexedCount} 件を索引済み（${bytes}）`
}

const en: typeof ja = {
  libraryTitle: 'Library',
  importAudio: 'Import Audio Files',
  searchPlaceholderSemantic: 'e.g. “meetings about the weather” (press Enter to search)',
  searchPlaceholderKeyword: 'Filter by title, summary, or transcript',
  searchModeLabel: 'Search mode',
  keywordMode: 'Keyword',
  semanticMode: 'Semantic',
  semanticModeHint: 'Search by meaning, e.g. “meetings about the weather”',
  foldersHeading: 'Folders',
  newFolder: 'New Folder',
  createSubfolder: 'Create Subfolder',
  renameFolder: 'Rename',
  deleteFolder: 'Delete',
  searchingAllFolders: 'Searching across all folders',
  noMatchingRecordings: 'No matching recordings.',
  noRecordingsInFolder:
    'No recordings in this folder. Drag a recording onto a folder above to move it.',
  noRecordingsYetPrefix: 'No recordings yet. Start one with the Record button below, or ',
  noRecordingsYetLink: 'import audio files',
  noRecordingsYetSuffix: '.',
  folderNamePlaceholder: 'Folder name',
  cancel: 'Cancel',
  renameFolderTitle: 'Rename Folder',
  createSubfolderTitle: 'Create Subfolder',
  newFolderTitle: 'New Folder',
  renameSubmit: 'Rename',
  createSubmit: 'Create',
  searchingTranscript: 'Searching transcripts…',
  transcriptHitsHeading: (count: number): string =>
    `Matches in transcript (${count} ${count === 1 ? 'result' : 'results'})`,
  semanticSearching: 'Searching…',
  semanticNoHits: 'No similar recordings found. Try rephrasing your search.',
  metaSeparator: ' · ',
  joinMeta: (...parts: readonly string[]): string => parts.join(' · '),
  allFolders: 'All Recordings',
  unfiledFolder: 'Unfiled',
  paneAriaLabel: 'Library width (double-click to reset)',
  paneTitle: 'Drag to resize, double-click to reset',
  // library/rows.ts
  today: 'Today',
  yesterday: 'Yesterday',
  thisWeek: 'This Week',
  thisMonth: 'This Month',
  monthHeading: (date: Date): string =>
    new Intl.DateTimeFormat(intlLocale(), { month: 'long' }).format(date),
  yearMonthHeading: (date: Date): string =>
    new Intl.DateTimeFormat(intlLocale(), { year: 'numeric', month: 'long' }).format(date),
  underOneMinute: 'Less than 1 minute',
  minutes: (value: number): string => `${value} min`,
  hours: (value: number): string => `${value} hr`,
  hoursMinutes: (hours: number, minutes: number): string => `${hours} hr ${minutes} min`,
  rowDateTime: (date: Date, time: string): string => {
    const monthDay = new Intl.DateTimeFormat(intlLocale(), { month: 'short', day: 'numeric' }).format(
      date
    )
    const weekday = new Intl.DateTimeFormat(intlLocale(), { weekday: 'short' }).format(date)
    return `${monthDay} (${weekday}) ${time}`
  },
  // library/fileDrop.ts
  importFailedOne: (fileName: string, reason: string): string =>
    `Couldn't import "${fileName}". ${reason}`,
  importFailedMany: (count: number, fileNames: readonly string[]): string =>
    `Couldn't import ${count} files: ${fileNames.join(', ')}`,
  // library/semanticSearch.ts
  sourceSummary: 'Summary',
  sourceNote: 'Notes',
  sourceTranscript: 'Transcript',
  searchModelMissing: 'Download the semantic search model from "Models" above.',
  indexChecking: 'Checking index…',
  indexBuilding: (done: number, total: number): string => `Building index (${done} of ${total})`,
  indexWaiting: 'The index will be built once recording processing finishes.',
  indexError: (message: string): string => `Couldn't build the index: ${message}`,
  indexSummary: (recordingCount: number, indexedCount: number, bytes: string): string =>
    `${indexedCount} of ${recordingCount} indexed (${bytes})`
}

export const libraryListText = localized({ ja, en })
