import type { ReactElement } from 'react'
import { RECORDING_SHORTCUT } from '@shared/shortcuts'
import { autoStartedMessage, startAlertMessage } from '@shared/startAlert'
import type { Transport } from '../hooks/useTransport'
import { formatDuration } from '../format'

/**
 * 画面下部に常時固定される操作バー。
 * どの画面にいても録音を開始・停止できることが要件なので、ビューの外側に置く。
 */
export const TransportBar = ({
  transport,
  shortcutEnabled
}: {
  transport: Transport
  /** グローバルショートカットが有効なら、ボタンの横にキーを添えて存在を知らせる。 */
  shortcutEnabled: boolean
}): ReactElement => {
  const { state, elapsedMs, level, busy, warning, silenceAlert, startAlert, autoStarted } = transport
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
      {shortcutEnabled && (
        <kbd className="transport__shortcut" title="どのアプリを見ていても録音を開始・停止できます">
          {RECORDING_SHORTCUT.label}
        </kbd>
      )}

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

      {/* 止め忘れの確認。通知を見逃してウィンドウへ戻ってきた場合でも
          ここで気づけるよう、応答するまで出し続ける。 */}
      {active && silenceAlert && (
        <div className="transport__silence" role="alert">
          <span>
            {Math.round(silenceAlert.silentDurationMs / 60_000)} 分以上、音が入っていません。
            録音を停止しますか？
          </span>
          <button type="button" onClick={() => void transport.stop()} disabled={busy}>
            停止する
          </button>
          <button type="button" onClick={transport.keepRecording}>
            続ける
          </button>
        </div>
      )}

      {/* 自動で始めた録音の取り消し口（ADR-041）。通知を見逃しても、録音中はここから破棄できる。 */}
      {active && autoStarted && autoStarted.recordingId === state.recordingId && (
        <div className="transport__start-alert" role="alert">
          <span>{autoStartedMessage(autoStarted.eventTitle)}</span>
          <button type="button" onClick={() => void transport.discard()} disabled={busy}>
            停止して破棄
          </button>
          <button type="button" onClick={transport.keepAutoStarted}>
            続ける
          </button>
        </div>
      )}

      {/* 開始忘れの確認。通知を見逃してウィンドウへ戻ってきた場合でも
          ここで気づけるよう、応答するまで出し続ける。 */}
      {!active && startAlert && (
        <div className="transport__start-alert" role="alert">
          <span>{`${startAlertMessage(startAlert)}録音を開始しますか？`}</span>
          <button type="button" onClick={() => void transport.start()} disabled={busy}>
            録音する
          </button>
          <button type="button" onClick={transport.skipRecording}>
            今はしない
          </button>
        </div>
      )}

      <div className="transport__meter" title="入力レベル（マイク／デスクトップ音声）">
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
