import { localized } from './locale'

const ja = {
  enableLabel: '意味検索を使う',
  enableHint:
    '「天気の話をした会議」のような文章で録音を探せるようにします。文字起こし・要約・メモを' +
    'この Mac の中でベクトル化して検索します。無効にするとインデックスは削除されます。',
  indexLabel: 'インデックス',
  checking: '確認中…',
  disabledWithRemainder: (count: number) => `無効（${count} 件分が残っています）`,
  disabled: '無効',
  deleteButton: 'インデックスを削除',
  deleting: '削除中…',
  deleteHint:
    '削除しても録音・文字起こし・要約・メモは消えません。意味検索が有効な間は、次に録音を処理したときなどに作り直されます。'
}

const en: typeof ja = {
  enableLabel: 'Use Semantic Search',
  enableHint:
    'Lets you find recordings with a phrase like “the meeting where we talked about the weather.” ' +
    'The transcript, summary, and notes are turned into vectors and searched entirely on this Mac. Disabling this deletes the index.',
  indexLabel: 'Index',
  checking: 'Checking…',
  disabledWithRemainder: (count: number) => `Off (${count} entries remain)`,
  disabled: 'Off',
  deleteButton: 'Delete Index',
  deleting: 'Deleting…',
  deleteHint:
    'Deleting it does not remove recordings, transcripts, summaries, or notes. While semantic search is enabled, it is rebuilt the next time a recording is processed, for example.'
}

/** 意味検索の設定（SemanticSearchSettings）の文言。 */
export const semanticSearchText = localized({ ja, en })
