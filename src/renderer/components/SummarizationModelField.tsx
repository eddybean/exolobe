import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { SummarizationProvider } from '@domain/Settings'
import { appleIntelligenceUnavailableText } from '@shared/i18n/appleIntelligence'
import type { AppleIntelligenceAvailabilityDto } from '@shared/ipc'
import { messageOf } from '../errorMessage'
import { locale } from '../i18n/locale'
import { settingsText } from '../i18n/settings'
import { appleIntelligenceChoice } from '../summarizationModel'

/**
 * 要約に使うモデルの選択（ADR-046）。
 *
 * Apple Intelligence は使える Mac でだけ選べる。選んだ人には、精度が Gemma より劣ることを
 * 選んでいる間ずっと見せる（選んだ瞬間だけの確認にすると、後から要約の質に驚く）。
 */
export const SummarizationModelField = ({
  provider,
  onChange
}: {
  provider: SummarizationProvider
  onChange: (provider: SummarizationProvider) => void
}): ReactElement => {
  const t = settingsText().summarization
  const [availability, setAvailability] = useState<AppleIntelligenceAvailabilityDto>()
  const [error, setError] = useState<string>()

  const refresh = useCallback((): void => {
    window.recorder
      .getAppleIntelligenceAvailability()
      .then(setAvailability)
      .catch((readError: unknown) => setError(messageOf(readError)))
  }, [])

  // システム設定で Apple Intelligence を有効にして戻ってきたら、読み直して選べるようにする。
  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const apple = appleIntelligenceChoice(availability)

  return (
    <div className="field">
      <label className="field__label" htmlFor="summarization-provider">
        {t.providerLabel}
      </label>
      <select
        id="summarization-provider"
        value={provider}
        onChange={(event) => onChange(event.target.value as SummarizationProvider)}
      >
        <option value="llama-cpp">{t.providerLlama}</option>
        {/* 選んだ後に使えなくなっても（OS 側で無効にした等）、選んだ状態は見せ続ける。 */}
        <option value="apple-intelligence" disabled={!apple.selectable}>
          {t.providerApple}
        </option>
      </select>
      <span className="field__hint">{t.providerHint}</span>
      {!apple.selectable && apple.reason && (
        <span className="field__hint">{appleIntelligenceUnavailableText(apple.reason, locale())}</span>
      )}
      {provider === 'apple-intelligence' && <p className="settings__caution">{t.appleWarning}</p>}
      {error && (
        <p className="settings__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
