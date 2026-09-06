import { useState, type ReactElement } from 'react'
import { SUPPORTED_SAMPLE_RATES, type Settings, type SettingsPatch } from '@domain/Settings'
import type { SetupStateDto } from '@shared/ipc'

/**
 * 設定画面。保存先とモデルの指定がここに集まる。
 *
 * 文字起こし・要約・話者識別のモデルはいずれもファイルパスで指定する。
 * ユースケースはモデルの実体を知らないため、ここを変えるだけで
 * 次回の処理から新しいモデルが使われる。
 */
export const SettingsView = ({
  setup,
  onChanged
}: {
  setup: SetupStateDto
  onChanged: () => void
}): ReactElement => {
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const settings = setup.settings

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

  return (
    <section className="settings">
      <header className="settings__header">
        <h2>設定</h2>
        {saved && <span className="settings__saved">保存しました</span>}
      </header>

      {error && (
        <p className="settings__error" role="alert">
          {error}
        </p>
      )}

      <Field label="保存先" hint="録音・文字起こし・要約の保存場所です。">
        <div className="settings__path">
          <code>{settings.storageDir ?? '未設定'}</code>
          <button
            type="button"
            onClick={() => {
              void window.recorder.chooseStorageDir().then((dir) => {
                if (dir) update({ storageDir: dir })
              })
            }}
          >
            変更
          </button>
        </div>
      </Field>

      <h3 className="settings__section">文字起こし</h3>

      <Field label="whisper モデル" hint="ggml 形式（.bin）のモデルを指定します。">
        <div className="settings__path">
          <code>{settings.transcription.modelPath || '未設定'}</code>
          <button
            type="button"
            onClick={() =>
              pickFile('whisper-model', (path) => ({ transcription: { modelPath: path } }))
            }
          >
            選択
          </button>
        </div>
      </Field>

      <Field label="whisper-cli のパス" hint="Homebrew で入れた場合は whisper-cli のままで動きます。">
        <input
          type="text"
          defaultValue={settings.transcription.binaryPath}
          onBlur={(event) => update({ transcription: { binaryPath: event.target.value } })}
        />
      </Field>

      <Field label="言語">
        <select
          value={settings.transcription.language}
          onChange={(event) => update({ transcription: { language: event.target.value } })}
        >
          <option value="ja">日本語</option>
          <option value="en">英語</option>
          <option value="auto">自動判定</option>
        </select>
      </Field>

      <h3 className="settings__section">要約</h3>

      <Field label="要約モデル" hint="GGUF 形式のモデルを指定します（例: Qwen3-8B Q4_K_M）。">
        <div className="settings__path">
          <code>{settings.summarization.modelPath || '未設定'}</code>
          <button
            type="button"
            onClick={() => pickFile('llm-model', (path) => ({ summarization: { modelPath: path } }))}
          >
            選択
          </button>
        </div>
      </Field>

      <Field label="コンテキスト長" hint="長い会議ほど大きい方が有利ですが、メモリを多く使います。">
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

      <Field label="要約プロンプト" hint="{{transcript}} の位置に文字起こしが差し込まれます。">
        <textarea
          className="settings__prompt"
          defaultValue={settings.summarization.promptTemplate}
          onBlur={(event) =>
            update({ summarization: { promptTemplate: event.target.value } })
          }
        />
      </Field>

      <h3 className="settings__section">話者識別</h3>

      <Field
        label="参加者を複数人に分ける"
        hint="無効でも「自分／参加者」の 2 話者には常に分かれます。"
      >
        <input
          type="checkbox"
          checked={settings.diarization.enabled}
          onChange={(event) => update({ diarization: { enabled: event.target.checked } })}
        />
      </Field>

      <Field label="話者数の上限">
        <input
          type="number"
          min={2}
          defaultValue={settings.diarization.maxSpeakers}
          onBlur={(event) => update({ diarization: { maxSpeakers: Number(event.target.value) } })}
        />
      </Field>

      <Field label="セグメンテーションモデル" hint="sherpa-onnx の pyannote 系 .onnx。">
        <div className="settings__path">
          <code>{settings.diarization.segmentationModelPath || '未設定'}</code>
          <button
            type="button"
            onClick={() =>
              pickFile('onnx-model', (path) => ({ diarization: { segmentationModelPath: path } }))
            }
          >
            選択
          </button>
        </div>
      </Field>

      <Field label="話者埋め込みモデル" hint="sherpa-onnx の speaker embedding .onnx。">
        <div className="settings__path">
          <code>{settings.diarization.embeddingModelPath || '未設定'}</code>
          <button
            type="button"
            onClick={() =>
              pickFile('onnx-model', (path) => ({ diarization: { embeddingModelPath: path } }))
            }
          >
            選択
          </button>
        </div>
      </Field>

      <h3 className="settings__section">音声</h3>

      <Field label="サンプルレート" hint="whisper は 16000Hz を前提としています。">
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

      <Field
        label="コーデック"
        hint="HE-AAC はさらに小さくなりますが 8kHz に落ちるため、会議音声では AAC-LC を推奨します。"
      >
        <select
          value={settings.audio.codec}
          onChange={(event) =>
            update({ audio: { codec: event.target.value as Settings['audio']['codec'] } })
          }
        >
          <option value="aac">AAC-LC（推奨）</option>
          <option value="aach">HE-AAC（最小サイズ）</option>
        </select>
      </Field>

      <Field label="ビットレート" hint="32kbps で 1 時間あたり約 14MB です。">
        <input
          type="number"
          min={8}
          step={8}
          defaultValue={settings.audio.bitrateKbps}
          onBlur={(event) => update({ audio: { bitrateKbps: Number(event.target.value) } })}
        />
      </Field>
    </section>
  )
}

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
