import { localized } from './locale'

const ja = {
  status: {
    recording: '録音中',
    processing: '処理中',
    ready: '完了',
    failed: '一部失敗'
  }
}

const en: typeof ja = {
  status: {
    recording: 'Recording',
    processing: 'Processing',
    ready: 'Done',
    failed: 'Partial failure'
  }
}

/** 録音の状態バッジの文言（一覧の右端に出す短い状態表示）。 */
export const formatText = localized({ ja, en })
