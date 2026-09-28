import { useState, type ReactElement, type ReactNode } from 'react'
import { formatGlossary, parseGlossary } from '@domain/Glossary'
import { type MemoryProtection } from '@domain/MemoryGuard'
import {
  APPEARANCES,
  SUPPORTED_SAMPLE_RATES,
  type Appearance,
  settingsSummaryPrompt,
  summarizationProviderOf,
  updateCheckIntervalOf,
  type Settings,
  type SettingsPatch
} from '@domain/Settings'
import type { SetupStateDto, UpdateStatusDto } from '@shared/ipc'
import { RECORDING_SHORTCUT } from '@shared/shortcuts'
import { CalendarSettings } from '../components/CalendarSettings'
import { LicenseNotices } from '../components/LicenseNotices'
import { ModelManager } from '../components/ModelManager'
import { RecordingPermissions } from '../components/RecordingPermissions'
import { SemanticSearchSettings } from '../components/SemanticSearchSettings'
import { SummarizationModelField } from '../components/SummarizationModelField'
import { UpdateSettings } from '../components/UpdateSettings'
import { VoiceprintSettings } from '../components/VoiceprintSettings'
import { SETTINGS_SECTIONS, type SettingsSectionId } from '../settingsSections'
import { locale } from '../i18n/locale'
import { settingsText } from '../i18n/settings'

/**
 * 設定画面。保存先とモデルの指定がここに集まる。左のナビで項目を選び、右にその項目だけを出す。
 *
 * 文字起こし・要約・話者識別のモデルはいずれもファイルパスで指定する。
 * ユースケースはモデルの実体を知らないため、ここを変えるだけで
 * 次回の処理から新しいモデルが使われる。
 */
export const SettingsView = ({
  setup,
  section,
  onSectionChange,
  onChanged,
  updateStatus,
  onUpdateStatus
}: {
  setup: SetupStateDto
  /** 表示する項目。画面を切り替えて戻っても続きから見られるよう、App が持つ。 */
  section: SettingsSectionId
  onSectionChange: (section: SettingsSectionId) => void
  onChanged: () => void
  /** 新しい版の確認の結果。ナビの知らせと同じものを見るよう、App が持つ。 */
  updateStatus: UpdateStatusDto | undefined
  onUpdateStatus: (status: UpdateStatusDto) => void
}): ReactElement => {
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const settings = setup.settings
  const t = settingsText()
  const usesGemma = summarizationProviderOf(settings) === 'llama-cpp'

  const update = (patch: SettingsPatch): void => {
    setError(undefined)
    window.recorder
      .updateSettings(patch)
      .then(() => {
        setSaved(true)
        window.setTimeout(() => setSaved(false), 1_500)
        onChanged()
      })
      .catch((updateError: unknown) => setError(messageOf(updateError)))
  }

  const pickFile = (kind: 'whisper-model' | 'llm-model' | 'onnx-model', apply: (path: string) => SettingsPatch): void => {
    window.recorder
      .chooseFile(kind)
      .then((path) => {
        if (path) update(apply(path))
      })
      .catch((pickError: unknown) => setError(messageOf(pickError)))
  }

  const content: Record<SettingsSectionId, ReactElement> = {
    recording: (
      <>
        {/* 許可が無いと録音そのものが成り立たないので、この項目の先頭に置く。 */}
        <RecordingPermissions />

        <SettingsCard title={t.recording.cardTitle}>
          <Field label={t.recording.silenceAlertLabel} hint={t.recording.silenceAlertHint}>
            <input
              type="checkbox"
              checked={settings.recording.silenceAlertEnabled}
              onChange={(event) => update({ recording: { silenceAlertEnabled: event.target.checked } })}
            />
          </Field>

          <Field label={t.recording.silenceDurationLabel} hint={t.recording.silenceDurationHint}>
            <input
              type="number"
              min={1}
              step={1}
              defaultValue={Math.round(settings.recording.silenceDurationMs / 60_000)}
              onBlur={(event) =>
                update({ recording: { silenceDurationMs: Number(event.target.value) * 60_000 } })
              }
            />
          </Field>

          <Field
            label={t.recording.globalShortcutLabel(RECORDING_SHORTCUT.label)}
            hint={t.recording.globalShortcutHint}
          >
            <input
              type="checkbox"
              checked={settings.recording.globalShortcutEnabled}
              onChange={(event) =>
                update({ recording: { globalShortcutEnabled: event.target.checked } })
              }
            />
          </Field>

          <Field label={t.recording.startAlertLabel} hint={t.recording.startAlertHint}>
            <input
              type="checkbox"
              checked={settings.recording.startAlertEnabled}
              onChange={(event) => update({ recording: { startAlertEnabled: event.target.checked } })}
            />
          </Field>

          <Field label={t.recording.startAlertDelayLabel} hint={t.recording.startAlertDelayHint}>
            <input
              type="number"
              min={0.5}
              step={0.5}
              defaultValue={settings.recording.startAlertDelayMs / 60_000}
              onBlur={(event) =>
                update({ recording: { startAlertDelayMs: Number(event.target.value) * 60_000 } })
              }
            />
          </Field>
        </SettingsCard>

        <CalendarSettings
          enabled={settings.recording.calendarEnabled}
          autoStartEnabled={settings.recording.autoStartEnabled}
          onChange={(calendarEnabled) => update({ recording: { calendarEnabled } })}
          onAutoStartChange={(autoStartEnabled) => update({ recording: { autoStartEnabled } })}
        />
      </>
    ),
    transcription: (
      <>
        <SettingsCard title={t.transcription.methodCardTitle}>
          <Field label={t.transcription.languageLabel}>
            <select
              value={settings.transcription.language}
              onChange={(event) => update({ transcription: { language: event.target.value } })}
            >
              <option value="ja">{t.transcription.languageOptionJa}</option>
              <option value="en">{t.transcription.languageOptionEn}</option>
              <option value="auto">{t.transcription.languageOptionAuto}</option>
            </select>
          </Field>

          <Field label={t.transcription.glossaryLabel} hint={t.transcription.glossaryHint}>
            <textarea
              className="settings__prompt"
              defaultValue={formatGlossary(settings.transcription.glossary)}
              onBlur={(event) =>
                update({ transcription: { glossary: parseGlossary(event.target.value) } })
              }
            />
          </Field>

          <Field label={t.transcription.vadLabel} hint={t.transcription.vadHint}>
            <input
              type="checkbox"
              checked={settings.transcription.vadEnabled}
              onChange={(event) => update({ transcription: { vadEnabled: event.target.checked } })}
            />
          </Field>
        </SettingsCard>

        <SettingsCard title={t.transcription.modelCardTitle}>
          <Field label={t.transcription.whisperModelLabel} hint={t.transcription.whisperModelHint}>
            <div className="settings__path">
              <code>{settings.transcription.modelPath || t.common.unset}</code>
              <button
                type="button"
                onClick={() =>
                  pickFile('whisper-model', (path) => ({ transcription: { modelPath: path } }))
                }
              >
                {t.common.choose}
              </button>
            </div>
          </Field>

          <Field label={t.transcription.vadModelLabel} hint={t.transcription.vadModelHint}>
            <div className="settings__path">
              <code>{settings.transcription.vadModelPath || t.common.unset}</code>
              <button
                type="button"
                onClick={() =>
                  pickFile('whisper-model', (path) => ({ transcription: { vadModelPath: path } }))
                }
              >
                {t.common.choose}
              </button>
            </div>
          </Field>

          <Field label={t.transcription.binaryPathLabel} hint={t.transcription.binaryPathHint}>
            <input
              type="text"
              defaultValue={settings.transcription.binaryPath}
              onBlur={(event) => update({ transcription: { binaryPath: event.target.value } })}
            />
          </Field>
        </SettingsCard>
      </>
    ),
    diarization: (
      <>
        <SettingsCard title={t.diarization.speakerCardTitle}>
          <Field label={t.diarization.enabledLabel} hint={t.diarization.enabledHint}>
            <input
              type="checkbox"
              checked={settings.diarization.enabled}
              onChange={(event) => update({ diarization: { enabled: event.target.checked } })}
            />
          </Field>

          <Field label={t.diarization.maxSpeakersLabel}>
            <input
              type="number"
              min={2}
              defaultValue={settings.diarization.maxSpeakers}
              onBlur={(event) => update({ diarization: { maxSpeakers: Number(event.target.value) } })}
            />
          </Field>

          <Field
            label={t.diarization.clusteringThresholdLabel}
            hint={t.diarization.clusteringThresholdHint}
          >
            <input
              type="number"
              min={0.1}
              max={1}
              step={0.05}
              defaultValue={settings.diarization.clusteringThreshold}
              onBlur={(event) =>
                update({ diarization: { clusteringThreshold: Number(event.target.value) } })
              }
            />
          </Field>
        </SettingsCard>

        <SettingsCard title={t.diarization.namingCardTitle}>
          <Field
            label={t.diarization.voiceprintThresholdLabel}
            hint={t.diarization.voiceprintThresholdHint}
          >
            <input
              type="number"
              min={0.1}
              max={1}
              step={0.05}
              defaultValue={settings.diarization.voiceprintThreshold}
              onBlur={(event) =>
                update({ diarization: { voiceprintThreshold: Number(event.target.value) } })
              }
            />
          </Field>

          <VoiceprintSettings enabled={settings.diarization.enabled} storageDir={settings.storageDir} />
        </SettingsCard>

        <SettingsCard title={t.diarization.modelCardTitle}>
          <Field
            label={t.diarization.segmentationModelLabel}
            hint={t.diarization.segmentationModelHint}
          >
            <div className="settings__path">
              <code>{settings.diarization.segmentationModelPath || t.common.unset}</code>
              <button
                type="button"
                onClick={() =>
                  pickFile('onnx-model', (path) => ({ diarization: { segmentationModelPath: path } }))
                }
              >
                {t.common.choose}
              </button>
            </div>
          </Field>

          <Field label={t.diarization.embeddingModelLabel} hint={t.diarization.embeddingModelHint}>
            <div className="settings__path">
              <code>{settings.diarization.embeddingModelPath || t.common.unset}</code>
              <button
                type="button"
                onClick={() =>
                  pickFile('onnx-model', (path) => ({ diarization: { embeddingModelPath: path } }))
                }
              >
                {t.common.choose}
              </button>
            </div>
          </Field>
        </SettingsCard>
      </>
    ),
    summarization: (
      <>
        <SettingsCard title={t.summarization.styleCardTitle}>
          <Field label={t.summarization.promptLabel} hint={t.summarization.promptHint}>
            {/* 既定のままなら会議の言語の既定を見せる（ADR-043）。key で作り直すのは、文字起こしの
                言語を変えたときに編集欄も切り替えるため（defaultValue は最初の描画にしか効かない）。 */}
            <textarea
              key={settingsSummaryPrompt(settings, locale())}
              className="settings__prompt"
              defaultValue={settingsSummaryPrompt(settings, locale())}
              onBlur={(event) =>
                update({ summarization: { promptTemplate: event.target.value } })
              }
            />
          </Field>

          {/* Apple Intelligence のコンテキスト長は OS のモデルが決めるので、Gemma のときだけ見せる。 */}
          {usesGemma && (
            <Field label={t.summarization.contextSizeLabel} hint={t.summarization.contextSizeHint}>
              <input
                type="number"
                min={1024}
                step={1024}
                defaultValue={settings.summarization.contextSize}
                onBlur={(event) =>
                  update({ summarization: { contextSize: Number(event.target.value) } })
                }
              />
            </Field>
          )}
        </SettingsCard>

        <SettingsCard title={t.summarization.modelCardTitle}>
          <SummarizationModelField
            provider={summarizationProviderOf(settings)}
            onChange={(provider) => update({ summarization: { provider } })}
          />

          {/* Gemma に戻したときのためにパスは残すが、使わない間は見せない。 */}
          {usesGemma && (
            <Field label={t.summarization.modelLabel} hint={t.summarization.modelHint}>
              <div className="settings__path">
                <code>{settings.summarization.modelPath || t.common.unset}</code>
                <button
                  type="button"
                  onClick={() =>
                    pickFile('llm-model', (path) => ({ summarization: { modelPath: path } }))
                  }
                >
                  {t.common.choose}
                </button>
              </div>
            </Field>
          )}

          <Field label={t.summarization.memoryProtectionLabel} hint={t.summarization.memoryProtectionHint}>
            <select
              value={settings.memoryProtection}
              onChange={(event) =>
                update({ memoryProtection: event.target.value as MemoryProtection })
              }
            >
              <option value="conservative">{t.summarization.memoryProtectionConservative}</option>
              <option value="standard">{t.summarization.memoryProtectionStandard}</option>
              <option value="off">{t.summarization.memoryProtectionOff}</option>
            </select>
          </Field>
        </SettingsCard>
      </>
    ),
    search: (
      <>
        <SettingsCard>
          <SemanticSearchSettings
            enabled={settings.search.enabled}
            onToggle={(enabled) => update({ search: { enabled } })}
          />
        </SettingsCard>
      </>
    ),
    models: (
      <>
        <SettingsCard>
          <p className="field__hint">{t.models.lead}</p>
          <ModelManager onChanged={onChanged} />
        </SettingsCard>
      </>
    ),
    storage: (
      <>
        <SettingsCard title={t.storage.cardTitle}>
          <Field label={t.storage.label} hint={t.storage.hint}>
            <div className="settings__path">
              <code>{settings.storageDir ?? t.common.unset}</code>
              <button
                type="button"
                onClick={() => {
                  void window.recorder.chooseStorageDir().then((dir) => {
                    if (dir) update({ storageDir: dir })
                  })
                }}
              >
                {t.common.change}
              </button>
            </div>
          </Field>
        </SettingsCard>

        <SettingsCard title={t.storage.audioCardTitle}>
          <Field label={t.storage.sampleRateLabel} hint={t.storage.sampleRateHint}>
            <select
              value={settings.audio.sampleRate}
              onChange={(event) => update({ audio: { sampleRate: Number(event.target.value) } })}
            >
              {SUPPORTED_SAMPLE_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {rate} Hz
                </option>
              ))}
            </select>
          </Field>

          <Field label={t.storage.codecLabel} hint={t.storage.codecHint}>
            <select
              value={settings.audio.codec}
              onChange={(event) =>
                update({ audio: { codec: event.target.value as Settings['audio']['codec'] } })
              }
            >
              <option value="aac">{t.storage.codecAac}</option>
              <option value="aach">{t.storage.codecHeAac}</option>
            </select>
          </Field>

          <Field label={t.storage.bitrateLabel} hint={t.storage.bitrateHint}>
            <input
              type="number"
              min={8}
              step={8}
              defaultValue={settings.audio.bitrateKbps}
              onBlur={(event) => update({ audio: { bitrateKbps: Number(event.target.value) } })}
            />
          </Field>
        </SettingsCard>
      </>
    ),
    appearance: (
      <SettingsCard>
        <Field label={t.appearance.label} hint={t.appearance.hint}>
          <select
            value={settings.appearance}
            onChange={(event) => update({ appearance: event.target.value as Appearance })}
          >
            {APPEARANCES.map((appearance) => (
              <option key={appearance} value={appearance}>
                {t.appearance[appearance]}
              </option>
            ))}
          </select>
        </Field>
      </SettingsCard>
    ),
    about: (
      <>
        <UpdateSettings
          status={updateStatus}
          interval={updateCheckIntervalOf(settings)}
          onIntervalChange={(updateCheck) => update({ updateCheck })}
          onStatus={onUpdateStatus}
        />
        <LicenseNotices />
      </>
    )
  }

  const current = SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0]

  return (
    <section className="settings">
      <nav className="settings__nav" aria-label={t.nav.ariaLabel}>
        {SETTINGS_SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              item.id === section ? 'settings__nav-item settings__nav-item--active' : 'settings__nav-item'
            }
            aria-current={item.id === section ? 'page' : undefined}
            onClick={() => onSectionChange(item.id)}
          >
            {t.sections[item.id]}
          </button>
        ))}
      </nav>

      <div className="settings__content">
        <header className="settings__header">
          <h2>{t.sections[current.id]}</h2>
          {saved && <span className="settings__saved">{t.saved}</span>}
        </header>

        {error && (
          <p className="settings__error" role="alert">
            {error}
          </p>
        )}

        {/* key で項目ごとに作り直す。未確定の入力（defaultValue）を別の項目へ持ち越さない。 */}
        <div key={section} className="settings__body">
          {content[section]}
        </div>
      </div>
    </section>
  )
}

/**
 * 関係する設定をまとめる角丸のカード。見出しと下線だけでは、どこからどこまでが
 * 一つのまとまりか読み取りにくかった。
 */
const SettingsCard = ({
  title,
  children
}: {
  title?: string
  children: ReactNode
}): ReactElement => (
  <section className="settings-card">
    {title && <h3 className="settings-card__title">{title}</h3>}
    {children}
  </section>
)

const Field = ({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactElement | ReactElement[]
}): ReactElement => (
  <label className="field">
    <span className="field__label">{label}</span>
    {children}
    {hint && <span className="field__hint">{hint}</span>}
  </label>
)

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
