import { useState, type ReactElement } from 'react'
import { UPDATE_CHECK_INTERVALS, type UpdateCheckInterval } from '@domain/AppUpdate'
import type { UpdateStatusDto } from '@shared/ipc'
import { formatDateTime } from '../format'
import { updateText } from '../i18n/update'
import { updateGuidance, type UpdateGuidance } from '../update'
import { CopyButton } from './CopyButton'

/**
 * 新しい版の確認（ADR-044）。いまの版・確認の間隔・今すぐ確認と、入れ方に応じた更新の案内。
 *
 * 確かめられなかったこと（非公開の間の 404 や通信の失敗）は見せない。知らせるだけの機能で、
 * 利用者に打てる手が無いため。
 */
export const UpdateSettings = ({
  status,
  interval,
  onIntervalChange,
  onStatus
}: {
  status: UpdateStatusDto | undefined
  interval: UpdateCheckInterval
  onIntervalChange: (interval: UpdateCheckInterval) => void
  onStatus: (status: UpdateStatusDto) => void
}): ReactElement => {
  const [checking, setChecking] = useState(false)
  const t = updateText()
  const guidance = status ? updateGuidance(status) : undefined

  const checkNow = (): void => {
    setChecking(true)
    window.recorder
      .checkForUpdate()
      .then(onStatus)
      .catch(() => undefined)
      .finally(() => setChecking(false))
  }

  return (
    <section className="settings-card">
      <h3 className="settings-card__title">{t.cardTitle}</h3>
      {status && <p className="update__version">{t.currentVersion(status.currentVersion)}</p>}

      <label className="field">
        <span className="field__label">{t.intervalLabel}</span>
        <select
          value={interval}
          onChange={(event) => onIntervalChange(event.target.value as UpdateCheckInterval)}
        >
          {UPDATE_CHECK_INTERVALS.map((value) => (
            <option key={value} value={value}>
              {t.intervals[value]}
            </option>
          ))}
        </select>
        <span className="field__hint">{t.intervalHint}</span>
      </label>

      <div className="update__check">
        <button type="button" onClick={checkNow} disabled={checking}>
          {t.checkNow}
        </button>
        <span className="update__state" role="status">
          {checking ? t.checking : guidance ? <Summary guidance={guidance} /> : null}
        </span>
      </div>

      {!checking && guidance && <Instructions guidance={guidance} />}
    </section>
  )
}

/** ボタンの横に出す一言。 */
const Summary = ({ guidance }: { guidance: UpdateGuidance }): ReactElement => {
  const t = updateText()
  switch (guidance.kind) {
    case 'unchecked':
      return <>{t.unchecked}</>
    case 'upToDate':
      return <>{t.upToDate(formatDateTime(guidance.checkedAt))}</>
    case 'homebrew':
    case 'download':
      return <strong>{t.available(guidance.version)}</strong>
  }
}

/** 新しい版があるときの、入れ方ごとの手順。 */
const Instructions = ({ guidance }: { guidance: UpdateGuidance }): ReactElement | null => {
  const t = updateText()
  switch (guidance.kind) {
    case 'homebrew':
      return (
        <div className="update__instructions">
          <p>{t.homebrewHint}</p>
          <div className="update__command">
            <code>{guidance.command}</code>
            <CopyButton text={guidance.command} label={t.copyCommand} />
          </div>
        </div>
      )
    case 'download':
      return (
        <div className="update__instructions">
          <p>{t.downloadHint}</p>
          <div>
            <button type="button" onClick={() => void window.recorder.openUpdatePage()}>
              {t.openPage}
            </button>
          </div>
        </div>
      )
    default:
      return null
  }
}
