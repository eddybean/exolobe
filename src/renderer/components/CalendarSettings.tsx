import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { CalendarPermissionDto } from '@shared/ipc'
import { messageOf } from '../errorMessage'
import { calendarPermissionView } from '../permissions'

/**
 * カレンダー連携（ADR-040）の入り切りと、その許可の状態。
 *
 * 入れた時点でまだ聞かれていなければ、その場で許可を求める。許可が無いまま入れておいても
 * 予定が引けないだけで録音には響かないので、入り切りと許可は別々に持つ。
 *
 * 会議の予定での自動開始（ADR-041）はカレンダー連携の下に別の項目として置く。
 * タイトルを埋めたくて連携を入れた人が、知らないうちに自動で録音される状態にしない。
 */
export const CalendarSettings = ({
  enabled,
  autoStartEnabled,
  onChange,
  onAutoStartChange
}: {
  enabled: boolean
  autoStartEnabled: boolean
  onChange: (enabled: boolean) => void
  onAutoStartChange: (enabled: boolean) => void
}): ReactElement => {
  const [permission, setPermission] = useState<CalendarPermissionDto>()
  const [error, setError] = useState<string>()

  const refresh = useCallback((): void => {
    window.recorder
      .getCalendarPermission()
      .then(setPermission)
      .catch((readError: unknown) => setError(messageOf(readError)))
  }, [])

  // システム設定で許可を切り替えて戻ってきたら、読み直して表示を合わせる。
  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const request = (): void => {
    setError(undefined)
    window.recorder
      .requestCalendarPermission()
      .then(setPermission)
      .catch((requestError: unknown) => setError(messageOf(requestError)))
  }

  const toggle = (checked: boolean): void => {
    onChange(checked)
    if (checked && permission === 'not-determined') request()
  }

  const openSettings = (): void => {
    window.recorder.openPrivacySettings('calendars').catch((openError: unknown) => {
      setError(messageOf(openError))
    })
  }

  const view = permission === undefined ? undefined : calendarPermissionView(permission)

  return (
    <section className="settings-card permissions" aria-labelledby="calendar-title">
      <h3 id="calendar-title" className="settings-card__title">
        カレンダー連携
      </h3>

      {error && (
        <p className="settings__error" role="alert">
          {error}
        </p>
      )}

      <label className="field">
        <span className="field__label">予定からタイトルと参加者を埋める</span>
        <input type="checkbox" checked={enabled} onChange={(event) => toggle(event.target.checked)} />
        <span className="field__hint">
          {'録音を始めた時刻に重なる予定のタイトルを録音の名前にし、参加者を話者名の候補に出します。'}
          {'会議の URL を含む予定の時間帯にマイクが使われたら、録音を早めに促します。'}
          {'macOS のカレンダーを読むだけで、どこにも送信しません。'}
        </span>
      </label>

      {enabled && (
        <label className="field">
          <span className="field__label">会議の予定の時間帯にマイクが使われたら、録音を自動で始める</span>
          <input
            type="checkbox"
            checked={autoStartEnabled}
            onChange={(event) => onAutoStartChange(event.target.checked)}
          />
          <span className="field__hint">
            {'Google Meet・Zoom・Teams の URL を含む予定があり、他のアプリがマイクを 30 秒使い続けたときだけ始めます。'}
            {'始めたら通知で知らせ、「停止して破棄」で何も残さずに取り消せます。止めた会議では再び自動で始めません。'}
          </span>
        </label>
      )}

      {enabled && (
        <div className="permissions__row">
          <div className="permissions__subject">
            <span className="permissions__name">カレンダー</span>
            <span className="permissions__purpose">予定の読み取り</span>
          </div>
          {view && (
            <span className={view.ok ? 'permissions__state permissions__state--ok' : 'permissions__state permissions__state--ng'}>
              {view.label}
            </span>
          )}
          {view?.action === 'request' && (
            <button type="button" onClick={request}>
              許可する
            </button>
          )}
          {view?.action === 'open-settings' && (
            <button type="button" onClick={openSettings}>
              システム設定を開く
            </button>
          )}
        </div>
      )}
    </section>
  )
}
