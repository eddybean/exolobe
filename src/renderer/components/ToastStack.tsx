import type { ReactElement } from 'react'
import { autoStartedMessage, startAlertMessage } from '@shared/startAlert'
import type { Toasts } from '../hooks/useToasts'
import type { Transport } from '../hooks/useTransport'
import { locale } from '../i18n/locale'
import { transportText } from '../i18n/transport'
import { persistentToastKinds, type PersistentToastKind } from '../toasts'

/**
 * フッターの真上に積むトースト。
 * 時間で消えるものを上、応答を待つものを下（フッター側）に置く。消える側が増減しても
 * ボタンの位置が動かず、押そうとした瞬間にずれて別のボタンを押すことがない。
 */
export const ToastStack = ({ transport, toasts }: { transport: Transport; toasts: Toasts }): ReactElement | null => {
  const kinds = persistentToastKinds({
    active: transport.state.active,
    ...(transport.state.recordingId === undefined ? {} : { recordingId: transport.state.recordingId }),
    silenceAlert: transport.silenceAlert,
    startAlert: transport.startAlert,
    autoStarted: transport.autoStarted
  })
  if (toasts.items.length === 0 && kinds.length === 0) return null

  const t = transportText()

  return (
    <div className="toasts">
      {toasts.items.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.tone}`}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          onMouseEnter={() => toasts.pause(toast.id)}
          onMouseLeave={() => toasts.resume(toast.id)}
        >
          <div className="toast__body">{toast.text}</div>
          <button
            type="button"
            className="toast__close"
            onClick={() => toasts.dismiss(toast.id)}
            aria-label={t.dismissToast}
          >
            ✕
          </button>
        </div>
      ))}
      {kinds.map((kind) => (
        <PersistentToast key={kind} kind={kind} transport={transport} />
      ))}
    </div>
  )
}

/** 通知を見逃してウィンドウへ戻ってきた場合でも気づけるよう、応答するまで出し続ける。 */
const PersistentToast = ({
  kind,
  transport
}: {
  kind: PersistentToastKind
  transport: Transport
}): ReactElement | null => {
  const t = transportText()
  const { busy } = transport

  const content = ((): { text: string; primary: [string, () => void]; secondary: [string, () => void] } | undefined => {
    switch (kind) {
      case 'silence':
        return transport.silenceAlert
          ? {
              text: t.silenceAlert(Math.round(transport.silenceAlert.silentDurationMs / 60_000)),
              primary: [t.stopButton, () => void transport.stop()],
              secondary: [t.keepRecording, transport.keepRecording]
            }
          : undefined
      // 自動で始めた録音の取り消し口（ADR-041）。
      case 'auto-started':
        return transport.autoStarted
          ? {
              text: autoStartedMessage(transport.autoStarted.eventTitle, locale()),
              primary: [t.stopAndDiscard, () => void transport.discard()],
              secondary: [t.keepRecording, transport.keepAutoStarted]
            }
          : undefined
      case 'start-alert':
        return transport.startAlert
          ? {
              text: `${startAlertMessage(transport.startAlert, locale())}${t.startAlertSuffix}`,
              primary: [t.startNow, () => void transport.start()],
              secondary: [t.skipForNow, transport.skipRecording]
            }
          : undefined
    }
  })()
  if (!content) return null

  return (
    <div className="toast toast--warning" role="alert">
      <div className="toast__body">
        <span>{content.text}</span>
        <div className="toast__actions">
          <button type="button" onClick={content.primary[1]} disabled={busy}>
            {content.primary[0]}
          </button>
          <button type="button" onClick={content.secondary[1]}>
            {content.secondary[0]}
          </button>
        </div>
      </div>
    </div>
  )
}
