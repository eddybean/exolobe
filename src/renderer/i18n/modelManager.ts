import { localized } from './locale'

const ja = {
  updateBadge: '更新あり',
  readyBadge: '取得済み',
  updateHint: (bytes: string) =>
    `このバージョンのアプリは新しい版のモデルを使います。更新すると ${bytes} をダウンロードし、古いファイルと置き換えます。`,
  percentOf: (percent: number, received: string, total: string) => `${percent}%（${received} / ${total}）`,
  cancelled: '中止しました。もう一度押すと途中から再開します。',
  cancel: '中止',
  download: 'ダウンロード',
  update: '更新',
  delete: '削除',
  deleting: '削除中…'
}

const en: typeof ja = {
  updateBadge: 'Update Available',
  readyBadge: 'Downloaded',
  updateHint: (bytes: string) =>
    `This version of the app uses a newer model. Updating downloads ${bytes} and replaces the old file.`,
  percentOf: (percent: number, received: string, total: string) => `${percent}% (${received} / ${total})`,
  cancelled: 'Cancelled. Press again to resume from where it left off.',
  cancel: 'Cancel',
  download: 'Download',
  update: 'Update',
  delete: 'Delete',
  deleting: 'Deleting…'
}

/** モデル一覧（ModelManager）の文言。モデルごとの名前・説明は @shared/i18n/models の modelText を使う。 */
export const modelManagerText = localized({ ja, en })
