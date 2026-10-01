import { localized } from './locale'

const ja = {
  fieldLabel: '覚えた声',
  needsStorage: '保存先を選ぶと、覚えた声をここに一覧します。',
  checking: '確認中…',
  empty: 'まだありません。録音の詳細画面で話者に名前を付けると、その声を覚えます。',
  openList: '一覧を開く',
  hintEnabled:
    '次の録音で同じ声が出てきたら、この名前を自動で当てはめます。違っていたら詳細画面で付け直してください。付け直した名前をそのまま覚え直します。',
  hintDisabled: '話者識別が無効なので、いまは自動で当てはめません。覚えた声はそのまま残ります。',
  modalTitle: (count: number) => `覚えた声（${count} 人）`,
  filterPlaceholder: '名前で絞り込む',
  noMatch: '当てはまる名前はありません。',
  forget: '忘れる',
  forgetAll: 'すべて忘れる',
  close: '閉じる'
}

const en: typeof ja = {
  fieldLabel: 'Learned Voices',
  needsStorage: 'Once you choose a save location, learned voices will be listed here.',
  checking: 'Checking…',
  empty: 'None yet. Naming a speaker in a recording’s detail view teaches the app that voice.',
  openList: 'Open List',
  hintEnabled:
    'When the same voice appears in the next recording, this name is applied automatically. If it is wrong, rename it in the detail view — the new name is learned in its place.',
  hintDisabled:
    'Speaker identification is off, so names are not applied automatically right now. Learned voices are kept as they are.',
  modalTitle: (count: number) => `Learned Voices (${count})`,
  filterPlaceholder: 'Filter by name',
  noMatch: 'No matching names.',
  forget: 'Forget',
  forgetAll: 'Forget All',
  close: 'Close'
}

/** 声で名前を当てる設定（VoiceprintSettings）の文言。 */
export const voiceprintsText = localized({ ja, en })
