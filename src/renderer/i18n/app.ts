import { localized } from './locale'

/** アプリの器（App.tsx）の文言。 */

const ja = {
  loading: '読み込み中…',
  navRecordings: '録音',
  navChat: 'チャット',
  navSettings: '設定',
  dropOverlayLabel: '音声ファイルをドロップすると取り込みます',
  importingStatus: (done: number, total: number, fileName: string): string =>
    '音声を取り込んでいます…' + (total > 0 ? ` ${done}/${total}` : '') + (fileName ? `（${fileName}）` : ''),
  dismissImportError: '取り込みのエラーを閉じる',
  detailEmpty: '左のライブラリから録音を選ぶと、文字起こし・要約・メモを表示します。'
}

const en: typeof ja = {
  loading: 'Loading…',
  navRecordings: 'Recordings',
  navChat: 'Chat',
  navSettings: 'Settings',
  dropOverlayLabel: 'Drop audio files here to import them.',
  importingStatus: (done: number, total: number, fileName: string): string =>
    'Importing audio…' + (total > 0 ? ` ${done}/${total}` : '') + (fileName ? ` (${fileName})` : ''),
  dismissImportError: 'Dismiss import error',
  detailEmpty: 'Select a recording from the library on the left to see its transcript, summary, and notes.'
}

export const appText = localized({ ja, en })
