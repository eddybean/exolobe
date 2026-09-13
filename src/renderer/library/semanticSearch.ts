import type { SearchHitDto, SearchIndexStatusDto } from '@shared/ipc'
import { formatBytes, formatDuration } from '../format'

const SOURCE_LABELS: Record<SearchHitDto['source'], string> = {
  summary: '要約',
  note: 'メモ',
  transcript: '文字起こし'
}

/** 結果のどこで当たったか。文字起こしなら、再生して確かめられるよう時刻を添える。 */
export const hitLocation = (hit: SearchHitDto): string => {
  const label = SOURCE_LABELS[hit.source]
  return hit.startMs === undefined ? label : `${label} ${formatDuration(hit.startMs)}`
}

/** 検索欄に「意味」の切り替えを出してよいか。 */
export const isSemanticSearchAvailable = (status: SearchIndexStatusDto | undefined): boolean =>
  status !== undefined && status.enabled && status.modelInstalled

/** 設定画面に出す索引の状態。消すかどうかを判断できるよう容量も添える。 */
export const searchIndexSummary = (status: SearchIndexStatusDto): string => {
  if (!status.modelInstalled) return '上の「モデル」から意味検索モデルをダウンロードしてください'

  const { sync } = status
  switch (sync.state) {
    case 'running':
      return sync.total === 0
        ? 'インデックスを確認中…'
        : `インデックスを作成中（${sync.done} / ${sync.total} 件）`
    case 'waiting':
      return '録音の処理が終わってからインデックスを作成します'
    case 'error':
      return `インデックスを作成できませんでした: ${sync.message}`
    case 'idle':
      return `${status.recordingCount} 件中 ${status.indexedCount} 件を索引済み（${formatBytes(status.bytes)}）`
  }
}
