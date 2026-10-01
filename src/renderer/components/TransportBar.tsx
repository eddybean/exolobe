import type { ReactElement } from 'react'
import { recordingShortcut } from '@shared/shortcuts'
import { autoStartedMessage, startAlertMessage } from '@shared/startAlert'
import type { Transport } from '../hooks/useTransport'
import { LevelTimeline } from './LevelTimeline'
import { formatDuration } from '../format'
import { locale } from '../i18n/locale'
import { transportText } from '../i18n/transport'
import { platform } from '../platform'

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
  const { state, elapsedMs, busy, warning, silenceAlert, startAlert, autoStarted } = transport
  const active = state.active
  const t = transportText()

  return (
    <footer className="transport">
      <button
        type="button"
        className={active ? 'transport__button transport__button--stop' : 'transport__button'}
        onClick={() => void (active ? transport.stop() : transport.start())}
        disabled={busy}
        aria-label={active ? t.stopRecording : t.startRecording}
      >
        <span className={active ? 'transport__icon transport__icon--stop' : 'transport__icon'} />
        {busy ? t.processing : active ? t.stop : t.record}
      </button>
      {shortcutEnabled && (
        <kbd className="transport__shortcut" title={t.shortcutHint}>
          {recordingShortcut(platform()).label}
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
          <span className="transport__idle">{t.idle}</span>
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
          <span>{t.silenceAlert(Math.round(silenceAlert.silentDurationMs / 60_000))}</span>
          <button type="button" onClick={() => void transport.stop()} disabled={busy}>
            {t.stopButton}
          </button>
          <button type="button" onClick={transport.keepRecording}>
            {t.keepRecording}
          </button>
        </div>
      )}

      {/* 自動で始めた録音の取り消し口（ADR-041）。通知を見逃しても、録音中はここから破棄できる。 */}
      {active && autoStarted && autoStarted.recordingId === state.recordingId && (
        <div className="transport__start-alert" role="alert">
          <span>{autoStartedMessage(autoStarted.eventTitle, locale())}</span>
          <button type="button" onClick={() => void transport.discard()} disabled={busy}>
            {t.stopAndDiscard}
          </button>
          <button type="button" onClick={transport.keepAutoStarted}>
            {t.keepRecording}
          </button>
        </div>
      )}

      {/* 開始忘れの確認。通知を見逃してウィンドウへ戻ってきた場合でも
          ここで気づけるよう、応答するまで出し続ける。 */}
      {!active && startAlert && (
        <div className="transport__start-alert" role="alert">
          <span>{`${startAlertMessage(startAlert, locale())}${t.startAlertSuffix}`}</span>
          <button type="button" onClick={() => void transport.start()} disabled={busy}>
            {t.startNow}
          </button>
          <button type="button" onClick={transport.skipRecording}>
            {t.skipForNow}
          </button>
        </div>
      )}

      <LevelTimeline active={active} readHistory={transport.levelHistory} title={t.meterTitle} />

      {transport.error && (
        <div className="transport__error" role="alert">
          <span>{transport.error}</span>
          <button type="button" onClick={transport.dismissError} aria-label={t.dismissError}>
            ✕
          </button>
        </div>
      )}
    </footer>
  )
}
