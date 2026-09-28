import type { SearchHitDto, SearchIndexStatusDto } from '@shared/ipc'
import { libraryListText } from '../i18n/libraryList'
import { formatBytes, formatDuration } from '../format'

/** 結果のどこで当たったか。文字起こしなら、再生して確かめられるよう時刻を添える。 */
export const hitLocation = (hit: SearchHitDto): string => {
  const t = libraryListText()
  const sourceLabels: Record<SearchHitDto['source'], string> = {
    summary: t.sourceSummary,
    note: t.sourceNote,
    transcript: t.sourceTranscript
  }
  const label = sourceLabels[hit.source]
  return hit.startMs === undefined ? label : `${label} ${formatDuration(hit.startMs)}`
}

/** 検索欄に「意味」の切り替えを出してよいか。 */
export const isSemanticSearchAvailable = (status: SearchIndexStatusDto | undefined): boolean =>
  status !== undefined && status.enabled && status.modelInstalled

/** 設定画面に出す索引の状態。消すかどうかを判断できるよう容量も添える。 */
export const searchIndexSummary = (status: SearchIndexStatusDto): string => {
  const t = libraryListText()
  if (!status.modelInstalled) return t.searchModelMissing

  const { sync } = status
  switch (sync.state) {
    case 'running':
      return sync.total === 0 ? t.indexChecking : t.indexBuilding(sync.done, sync.total)
    case 'waiting':
      return t.indexWaiting
    case 'error':
      return t.indexError(sync.message)
    case 'idle':
      return t.indexSummary(status.recordingCount, status.indexedCount, formatBytes(status.bytes))
  }
}
