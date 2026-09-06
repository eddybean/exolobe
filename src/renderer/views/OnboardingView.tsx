import { useState, type ReactElement } from 'react'
import type { SetupStateDto } from '@shared/ipc'
import { ModelManager } from '../components/ModelManager'

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
      <h2>はじめに</h2>
      <p className="onboarding__lead">
        会議の音声を録音し、文字起こし・話者識別・要約までをこの Mac の中だけで行います。
        音声もテキストも外部には送信されません。
      </p>

      {error && (
        <p className="onboarding__error" role="alert">
          {error}
        </p>
      )}

      <ol className="onboarding__steps">
        <li className={setup.needsStorageDir ? 'todo' : 'done'}>
          <div>
            <strong>保存先を選ぶ</strong>
            <p>録音・文字起こし・要約の保存場所です。これを決めると録音を始められます。</p>
            <code>{setup.settings.storageDir ?? '未設定'}</code>
          </div>
          <button type="button" onClick={chooseStorage}>
            {setup.needsStorageDir ? '選択' : '変更'}
          </button>
        </li>

      </ol>

      <h3 className="onboarding__section">モデルを取得する</h3>
      <p className="onboarding__lead">
        文字起こしと要約に使うモデルをダウンロードします。合計で約 5.7GB あり、
        回線によっては時間がかかります。中断しても途中から再開できます。
        <strong>モデルが無くても録音は始められます</strong>ので、
        先に会議を録っておいて後から処理することもできます。
      </p>

      <ModelManager onChanged={onChanged} />

      <p className="onboarding__note">
        細かい設定や、手元にあるモデルの指定は
        <button type="button" className="onboarding__link" onClick={onOpenSettings}>
          設定画面
        </button>
        から行えます。
      </p>

      <p className="onboarding__note">
        初回の録音時に「マイク」と「オーディオ録音」の許可を求められます。どちらも許可してください。
      </p>
    </section>
  )
}
