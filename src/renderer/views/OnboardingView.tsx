import { useState, type ReactElement } from 'react'
import type { SetupStateDto } from '@shared/ipc'
import { ModelManager } from '../components/ModelManager'
import { onboardingText } from '../i18n/onboarding'

/**
 * 初回起動時の案内。
 *
 * 保存先が決まるまでは録音できないため、そこだけを必須にする。
 * モデルは後から設定しても録音自体は始められるので、任意として案内する
 * （録音が最優先で、文字起こし・要約は後追いで実行できる設計）。
 */
export const OnboardingView = ({
  setup,
  onChanged,
  onOpenSettings
}: {
  setup: SetupStateDto
  onChanged: () => void
  onOpenSettings: () => void
}): ReactElement => {
  const t = onboardingText()
  const [error, setError] = useState<string>()

  const chooseStorage = (): void => {
    window.recorder
      .chooseStorageDir()
      .then(async (dir) => {
        if (!dir) return
        await window.recorder.updateSettings({ storageDir: dir })
        onChanged()
      })
      .catch((chooseError: unknown) =>
        setError(chooseError instanceof Error ? chooseError.message : String(chooseError))
      )
  }

  return (
    <section className="onboarding">
      <h2>{t.title}</h2>
      <p className="onboarding__lead">{t.lead}</p>

      {error && (
        <p className="onboarding__error" role="alert">
          {error}
        </p>
      )}

      <ol className="onboarding__steps">
        <li className={setup.needsStorageDir ? 'todo' : 'done'}>
          <div>
            <strong>{t.step1Title}</strong>
            <p>{t.step1Description}</p>
            <code>{setup.settings.storageDir ?? t.unset}</code>
          </div>
          <button type="button" onClick={chooseStorage}>
            {setup.needsStorageDir ? t.choose : t.change}
          </button>
        </li>

      </ol>

      <h3 className="onboarding__section">{t.modelsSectionTitle}</h3>
      <p className="onboarding__lead">
        {t.modelsLead1}
        <strong>{t.modelsLeadStrong}</strong>
        {t.modelsLead2}
      </p>

      <ModelManager onChanged={onChanged} />

      <p className="onboarding__note">
        {t.settingsNote1}
        <button type="button" className="onboarding__link" onClick={onOpenSettings}>
          {t.settingsLink}
        </button>
        {t.settingsNote2}
      </p>

      <p className="onboarding__note">{t.permissionsNote}</p>
    </section>
  )
}
