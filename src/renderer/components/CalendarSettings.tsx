import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { CalendarPermissionDto } from '@shared/ipc'
import { messageOf } from '../errorMessage'
import { calendarPermissionView } from '../permissions'

/**
 * カレンダー連携（ADR-040）の入り切りと、その許可の状態。
 *
 * 入れた時点でまだ聞かれていなければ、その場で許可を求める。許可が無いまま入れておいても
 * 予定が引けないだけで録音には響かないので、入り切りと許可は別々に持つ。
 */
export const CalendarSettings = ({
  enabled,
  onChange
}: {
  enabled: boolean
  onChange: (enabled: boolean) => void
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
          {'macOS のカレンダーを読むだけで、どこにも送信しません。録音を自動で始めることはありません。'}
        </span>
      </label>

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
