import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { ManagedAssetStatusDto, ModelProgressDto } from '@shared/ipc'
import { messageOf } from '../errorMessage'
import { formatBytes } from '../format'

type ProgressMap = Record<string, ModelProgressDto | undefined>
type ErrorMap = Record<string, string | undefined>

/**
 * モデルの取得状況と操作をまとめた一覧。
 *
 * 配布版の利用者に Homebrew も手動ダウンロードも求めないための画面。
 * 進捗と中止を出すのは、要約モデルが 5GB あり、回線によっては数十分かかるため。
 * 中断しても途中までは保存され、次回は続きから再開される。
 *
 * 削除を置くのは、モデルが合計 6GB 近くになり、使わないものを残す理由が薄いため。
 * 再取得できるので、消しても失われるのはダウンロードの時間だけ。
 *
 * 更新を出すのは、アプリの更新でモデルが差し替わったとき、手元の古いファイルが
 * 黙って使われ続けないようにするため。比べる相手は上流ではなくアプリが想定する版。
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
  const [errors, setErrors] = useState<ErrorMap>({})
  const [deleting, setDeleting] = useState<string | undefined>()

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

  const acquire = useCallback((id: string, mode: 'download' | 'update'): void => {
    setErrors((current) => ({ ...current, [id]: undefined }))
    setProgress((current) => ({
      ...current,
      [id]: { id, receivedBytes: 0, status: 'downloading' }
    }))
    const request =
      mode === 'update' ? window.recorder.updateModel(id) : window.recorder.downloadModel(id)
    // 完了・失敗は進捗イベントで反映されるので、ここでは結果を待たない。
    void request.catch(() => undefined)
  }, [])

  const remove = useCallback(
    async (id: string): Promise<void> => {
      setErrors((current) => ({ ...current, [id]: undefined }))
      if (!(await window.recorder.confirmDeleteModel(id))) return

      setDeleting(id)
      try {
        await window.recorder.deleteModel(id)
        // 前回の中止メッセージなどが残ると、削除後の行の説明として噛み合わない。
        setProgress((current) => ({ ...current, [id]: undefined }))
        await refresh()
        onChanged()
      } catch (error: unknown) {
        setErrors((current) => ({ ...current, [id]: messageOf(error) }))
      } finally {
        setDeleting(undefined)
      }
    },
    [refresh, onChanged]
  )

  const visible = compact ? assets.filter((asset) => !asset.optional) : assets

  return (
    <ul className="models">
      {visible.map((asset) => (
        <ModelRow
          key={asset.id}
          asset={asset}
          progress={progress[asset.id]}
          error={errors[asset.id]}
          deleting={deleting === asset.id}
          onDownload={() => acquire(asset.id, 'download')}
          onUpdate={() => acquire(asset.id, 'update')}
          onCancel={() => void window.recorder.cancelModelDownload(asset.id)}
          onDelete={() => void remove(asset.id)}
        />
      ))}
    </ul>
  )
}

const ModelRow = ({
  asset,
  progress,
  error,
  deleting,
  onDownload,
  onUpdate,
  onCancel,
  onDelete
}: {
  asset: ManagedAssetStatusDto
  progress: ModelProgressDto | undefined
  error: string | undefined
  deleting: boolean
  onDownload: () => void
  onUpdate: () => void
  onCancel: () => void
  onDelete: () => void
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
          {asset.installed &&
            (asset.updateAvailable ? (
              <span className="badge badge--update">更新あり</span>
            ) : (
              <span className="badge badge--ready">取得済み</span>
            ))}
        </div>
        <p className="models__description">{asset.description}</p>
        {asset.installed && asset.updateAvailable && !downloading && (
          <p className="models__hint">
            このバージョンのアプリは新しい版のモデルを使います。更新すると{' '}
            {formatBytes(asset.bytes)} をダウンロードし、古いファイルと置き換えます。
          </p>
        )}

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

        {(error ?? (progress?.status === 'failed' ? progress.error : undefined)) && (
          <p className="models__error" role="alert">
            {error ?? progress?.error}
          </p>
        )}
        {progress?.status === 'cancelled' && (
          <p className="models__hint">中止しました。もう一度押すと途中から再開します。</p>
        )}
      </div>

      <div className="models__actions">
        {downloading && (
          <button type="button" onClick={onCancel}>
            中止
          </button>
        )}
        {!downloading && !asset.installed && (
          <button type="button" onClick={onDownload}>
            ダウンロード
          </button>
        )}
        {!downloading && asset.installed && asset.updateAvailable && (
          <button type="button" onClick={onUpdate} disabled={deleting}>
            更新
          </button>
        )}
        {!downloading && asset.installed && (
          <button type="button" className="danger" onClick={onDelete} disabled={deleting}>
            {deleting ? '削除中…' : '削除'}
          </button>
        )}
      </div>
    </li>
  )
}
