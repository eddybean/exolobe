import type { ReactElement } from 'react'
import { recordingShortcut } from '@shared/shortcuts'
import type { Toasts } from '../hooks/useToasts'
import type { Transport } from '../hooks/useTransport'
import { LevelTimeline } from './LevelTimeline'
import { ToastStack } from './ToastStack'
import { formatDuration } from '../format'
import { transportText } from '../i18n/transport'
import { platform } from '../platform'

/**
 * 画面下部に常時固定される操作バー。
 * どの画面にいても録音を開始・停止できることが要件なので、ビューの外側に置く。
 */
export const TransportBar = ({
  transport,
  toasts,
  shortcutEnabled
}: {
  transport: Transport
  toasts: Toasts
  /** グローバルショートカットが有効なら、ボタンの横にキーを添えて存在を知らせる。 */
  shortcutEnabled: boolean
}): ReactElement => {
  const { state, elapsedMs, busy, warning } = transport
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
          時間で消えるトーストとは別に、短い札をフッターに残す。 */}
      {active && warning && (
        <span className="transport__mic-missing" role="status" title={warning}>
          {t.micMissingBadge}
        </span>
      )}

      <LevelTimeline active={active} readHistory={transport.levelHistory} title={t.meterTitle} />

      <ToastStack transport={transport} toasts={toasts} />
    </footer>
  )
}
