import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { ManagedAssetStatusDto, ModelProgressDto } from '@shared/ipc'
import { formatBytes } from '../format'

type ProgressMap = Record<string, ModelProgressDto | undefined>

/**
 * モデルの取得状況と操作をまとめた一覧。
 *
 * 配布版の利用者に Homebrew も手動ダウンロードも求めないための画面。
 * 進捗と中止を出すのは、要約モデルが 5GB あり、回線によっては数十分かかるため。
 * 中断しても途中までは保存され、次回は続きから再開される。
 */
export const ModelManager = ({
  onChanged,
  compact
}: {
  onChanged: () => void
  compact?: boolean
}): ReactElement => {
  const [assets, setAssets] = useState<ManagedAssetStatusDto[]>([])
  const [progress, setProgress] = useState<ProgressMap>({})

  const refresh = useCallback(async (): Promise<void> => {
    setAssets(await window.recorder.getModelStatus())
  }, [])

  useEffect(() => {
    void refresh()

    return window.recorder.onModelProgress((event) => {
      setProgress((current) => ({ ...current, [event.id]: event }))
      if (event.status !== 'downloading') {
        void refresh()
        onChanged()
      }
    })
  }, [refresh, onChanged])

  const download = useCallback((id: string): void => {
    setProgress((current) => ({
      ...current,
      [id]: { id, receivedBytes: 0, status: 'downloading' }
    }))
    // 完了・失敗は進捗イベントで反映されるので、ここでは結果を待たない。
    void window.recorder.downloadModel(id).catch(() => undefined)
  }, [])

  const visible = compact ? assets.filter((asset) => !asset.optional) : assets

  return (
    <ul className="models">
      {visible.map((asset) => (
        <ModelRow
          key={asset.id}
          asset={asset}
          progress={progress[asset.id]}
          onDownload={() => download(asset.id)}
          onCancel={() => void window.recorder.cancelModelDownload(asset.id)}
        />
      ))}
    </ul>
  )
}

const ModelRow = ({
  asset,
  progress,
  onDownload,
  onCancel
}: {
  asset: ManagedAssetStatusDto
  progress: ModelProgressDto | undefined
  onDownload: () => void
  onCancel: () => void
}): ReactElement => {
  const downloading = progress?.status === 'downloading'
  const total = progress?.totalBytes ?? asset.bytes
  const percent =
    downloading && total > 0 ? Math.min(100, Math.round((progress.receivedBytes / total) * 100)) : 0

  return (
    <li className={asset.installed ? 'models__item models__item--done' : 'models__item'}>
      <div className="models__info">
        <div className="models__row">
          <strong>{asset.label}</strong>
          <span className="models__size">{formatBytes(asset.bytes)}</span>
          {asset.installed && <span className="badge badge--ready">取得済み</span>}
        </div>
        <p className="models__description">{asset.description}</p>

        {downloading && (
          <div className="models__progress">
            <div className="models__bar">
              <div className="models__bar-fill" style={{ width: `${percent}%` }} />
            </div>
            <span className="models__percent">
              {percent}%（{formatBytes(progress.receivedBytes)} / {formatBytes(total)}）
            </span>
          </div>
        )}

        {progress?.status === 'failed' && (
          <p className="models__error" role="alert">
            {progress.error}
          </p>
        )}
        {progress?.status === 'cancelled' && (
          <p className="models__hint">中止しました。もう一度押すと途中から再開します。</p>
        )}
      </div>

      <div className="models__actions">
        {downloading ? (
          <button type="button" onClick={onCancel}>
            中止
          </button>
        ) : (
          <button type="button" onClick={onDownload} disabled={asset.installed}>
            {asset.installed ? '完了' : 'ダウンロード'}
          </button>
        )}
      </div>
    </li>
  )
}
