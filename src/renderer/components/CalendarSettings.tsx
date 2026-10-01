import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { CalendarPermissionDto } from '@shared/ipc'
import { messageOf } from '../errorMessage'
import { calendarText } from '../i18n/calendar'
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
  const t = calendarText()
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
        {t.title}
      </h3>

      {error && (
        <p className="settings__error" role="alert">
          {error}
        </p>
      )}

      <label className="field">
        <span className="field__label">{t.fillLabel}</span>
        <input type="checkbox" checked={enabled} onChange={(event) => toggle(event.target.checked)} />
        <span className="field__hint">
          {t.fillHint1}
          {t.fillHint2}
          {t.fillHint3}
        </span>
      </label>

      {enabled && (
        <label className="field">
          <span className="field__label">{t.autoStartLabel}</span>
          <input
            type="checkbox"
            checked={autoStartEnabled}
            onChange={(event) => onAutoStartChange(event.target.checked)}
          />
          <span className="field__hint">
            {t.autoStartHint1}
            {t.autoStartHint2}
          </span>
        </label>
      )}

      {enabled && (
        <div className="permissions__row">
          <div className="permissions__subject">
            <span className="permissions__name">{t.subjectName}</span>
            <span className="permissions__purpose">{t.subjectPurpose}</span>
          </div>
          {view && (
            <span
              className={
                view.ok ? 'permissions__state permissions__state--ok' : 'permissions__state permissions__state--ng'
              }
            >
              {view.label}
            </span>
          )}
          {view?.action === 'request' && (
            <button type="button" onClick={request}>
              {t.allow}
            </button>
          )}
          {view?.action === 'open-settings' && (
            <button type="button" onClick={openSettings}>
              {t.openSettings}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
