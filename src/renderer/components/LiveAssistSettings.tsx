import { useEffect, useState, type ReactElement } from 'react'
import type { Settings, SettingsPatch } from '@domain/Settings'
import { appleIntelligenceUnavailableText } from '@shared/i18n/appleIntelligence'
import type { LiveAssistAvailabilityDto } from '@shared/ipc'
import { settingsText } from '../i18n/settings'
import { locale } from '../i18n/locale'
import { liveAssistSetting } from '../library/liveAssist'

/**
 * 録音中のアシスト（ADR-050、リサーチプレビュー）の設定。macOS でだけ出す。
 *
 * 使えない機能は隠さずに理由を添えて無効にする — 何をすれば使えるか（OS を上げる・意味検索を入れる・
 * Apple Intelligence を有効にする）が利用者ごとに違う。
 */
export const LiveAssistSettings = ({
  settings,
  onChange
}: {
  settings: Settings
  onChange: (patch: SettingsPatch) => void
}): ReactElement => {
  const t = settingsText().liveAssist
  const [availability, setAvailability] = useState<LiveAssistAvailabilityDto>()

  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      window.recorder
        .getLiveAssistAvailability()
        .then((value) => {
          if (alive) setAvailability(value)
        })
        .catch(() => undefined)
    }
    refresh()
    // システム設定で Apple Intelligence を有効にして戻ってきたら、読み直して表示を合わせる。
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      window.removeEventListener('focus', refresh)
    }
  }, [settings.transcription.language])

  const live = settings.liveAssist
  const choice = liveAssistSetting(availability?.captions)
  const searchReady = settings.search.enabled && settings.search.modelPath !== ''
  const apple = availability?.appleIntelligence
  const appleReady = apple === 'available'
  const update = (patch: Partial<Settings['liveAssist']>): void => onChange({ liveAssist: patch })

  return (
    <section className="settings-card" aria-labelledby="live-assist-title">
      <h3 id="live-assist-title" className="settings-card__title">
        {t.title} <span className="live-assist__badge">{t.preview}</span>
      </h3>
      <p className="field__hint">{t.description}</p>

      <label className="field">
        <span className="field__label">{t.enabledLabel}</span>
        <input
          type="checkbox"
          // 使えなくなった（OS を戻した等）なら、保存済みの値に関わらず入っていない姿で出す。
          checked={live.enabled && choice.selectable}
          disabled={!choice.selectable}
          onChange={(event) => update({ enabled: event.target.checked })}
        />
        {!choice.selectable && choice.reason && <span className="field__hint">{t.unavailable[choice.reason]}</span>}
        {choice.selectable && availability?.assets === 'downloadable' && (
          <span className="field__hint">{t.assetsHint}</span>
        )}
      </label>

      {live.enabled && choice.selectable && (
        <>
          <label className="field">
            <span className="field__label">{t.captionsLabel}</span>
            <input
              type="checkbox"
              checked={live.captions}
              onChange={(event) => update({ captions: event.target.checked })}
            />
            <span className="field__hint">{t.captionsHint}</span>
          </label>

          <label className="field">
            <span className="field__label">{t.pastRecordingsLabel}</span>
            <input
              type="checkbox"
              checked={live.pastRecordings && searchReady}
              disabled={!searchReady}
              onChange={(event) => update({ pastRecordings: event.target.checked })}
            />
            <span className="field__hint">{searchReady ? t.pastRecordingsHint : t.pastRecordingsNeedsSearch}</span>
          </label>

          <label className="field">
            <span className="field__label">{t.headlinesLabel}</span>
            <input
              type="checkbox"
              checked={live.headlines && appleReady}
              disabled={!appleReady}
              onChange={(event) => update({ headlines: event.target.checked })}
            />
            <span className="field__hint">
              {apple !== undefined && apple !== 'available'
                ? appleIntelligenceUnavailableText(apple, locale())
                : t.headlinesHint}
            </span>
          </label>

          {live.headlines && appleReady && (
            <label className="field">
              <span className="field__label">{t.headlineIntervalLabel}</span>
              <input
                type="number"
                min={2}
                max={30}
                step={1}
                defaultValue={live.headlineIntervalMin}
                onBlur={(event) => update({ headlineIntervalMin: Number(event.target.value) })}
              />
              <span className="field__hint">{t.headlineIntervalHint}</span>
            </label>
          )}
        </>
      )}
    </section>
  )
}
