import type { ReactElement } from 'react'
import type { Transport } from '../hooks/useTransport'
import { formatDuration } from '../format'

/**
 * 画面下部に常時固定される操作バー。
 * どの画面にいても録音を開始・停止できることが要件なので、ビューの外側に置く。
 */
export const TransportBar = ({ transport }: { transport: Transport }): ReactElement => {
  const { state, elapsedMs, level, busy, warning } = transport
  const active = state.active

  return (
    <footer className="transport">
      <button
        type="button"
        className={active ? 'transport__button transport__button--stop' : 'transport__button'}
        onClick={() => void (active ? transport.stop() : transport.start())}
        disabled={busy}
        aria-label={active ? '録音を停止' : '録音を開始'}
      >
        <span className={active ? 'transport__icon transport__icon--stop' : 'transport__icon'} />
        {busy ? '処理中…' : active ? '停止' : '録音'}
      </button>

      <div className="transport__status">
        {active ? (
          <>
            <span className="transport__dot" aria-hidden="true" />
            <span className="transport__time">{formatDuration(elapsedMs)}</span>
            <span className="transport__title">{state.title}</span>
          </>
        ) : (
          <span className="transport__idle">待機中</span>
        )}
      </div>

      {/* マイクが取れていないことは録音中ずっと見えていないと意味がないので、
          閉じられるエラーとは別扱いにして出し続ける。 */}
      {active && warning && (
        <div className="transport__warning" role="status">
          <span aria-hidden="true">⚠</span>
          <span>{warning}</span>
        </div>
      )}

      <div className="transport__meter" title="マイク入力レベル">
        <div className="transport__meter-fill" style={{ width: `${Math.round(level * 100)}%` }} />
      </div>

      {transport.error && (
        <div className="transport__error" role="alert">
          <span>{transport.error}</span>
          <button type="button" onClick={transport.dismissError} aria-label="エラーを閉じる">
            ✕
          </button>
        </div>
      )}
    </footer>
  )
}
