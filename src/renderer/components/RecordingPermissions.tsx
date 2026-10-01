import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { MicPermissionDto, PrivacyPaneDto } from '@shared/ipc'
import { playCheckTone } from '../audio/checkTone'
import { startMicCapture } from '../audio/micCapture'
import { messageOf } from '../errorMessage'
import { permissionsText } from '../i18n/permissions'
import { inputCheckView, micPermissionView, type InputCheckRow } from '../permissions'
import { runInputCheck } from '../session/runInputCheck'

/**
 * 録音に必要な 2 つの許可（マイク・システム音声）の状態と、直し方への入口。
 *
 * マイクは macOS に状態を問い合わせられる。システム音声（Core Audio Tap、ADR-001）は
 * 問い合わせる公開 API が無く、許可が無くてもエラーにならず無音が流れるだけなので、
 * 状態は出さず、どこで確かめればよいかを案内する。
 */
export const RecordingPermissions = (): ReactElement => {
  const t = permissionsText()
  const [mic, setMic] = useState<MicPermissionDto>()
  const [error, setError] = useState<string>()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<InputCheckRow[]>()

  const refresh = useCallback((): void => {
    window.recorder
      .getMicPermission()
      .then(setMic)
      .catch((readError: unknown) => setError(messageOf(readError)))
  }, [])

  // システム設定で許可を切り替えて戻ってきたら、読み直して表示を合わせる。
  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const openSettings = (pane: PrivacyPaneDto): void => {
    window.recorder.openPrivacySettings(pane).catch((openError: unknown) => {
      setError(messageOf(openError))
    })
  }

  const requestMic = (): void => {
    window.recorder
      .requestMicPermission()
      .then(refresh)
      .catch((requestError: unknown) => setError(messageOf(requestError)))
  }

  const runTest = (): void => {
    setTesting(true)
    setTestResult(undefined)
    setError(undefined)
    runInputCheck({
      // 取ったマイクの音はどこにも送らない。レベルだけを見る。
      startMic: () => startMicCapture({ sampleRate: 16_000, onPcm: () => undefined }),
      probeSystemAudio: (durationMs) => window.recorder.probeSystemAudio(durationMs),
      playTone: playCheckTone,
      wait: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
      every: (ms, tick) => {
        const timer = window.setInterval(tick, ms)
        return () => window.clearInterval(timer)
      }
    })
      .then((result) => setTestResult(inputCheckView(result)))
      .catch((testError: unknown) => setError(messageOf(testError)))
      .finally(() => {
        setTesting(false)
        // テストでマイクの許可を求められたかもしれないので、表示を合わせる。
        refresh()
      })
  }

  const micView = mic === undefined ? undefined : micPermissionView(mic)

  return (
    <section className="settings-card permissions" aria-labelledby="permissions-title">
      <h3 id="permissions-title" className="settings-card__title">
        {t.cardTitle}
      </h3>

      {error && (
        <p className="settings__error" role="alert">
          {error}
        </p>
      )}

      <div className="permissions__row">
        <div className="permissions__subject">
          <span className="permissions__name">{t.micName}</span>
          <span className="permissions__purpose">{t.micPurpose}</span>
        </div>
        {micView && (
          <span
            className={
              micView.ok ? 'permissions__state permissions__state--ok' : 'permissions__state permissions__state--ng'
            }
          >
            {micView.label}
          </span>
        )}
        {micView?.action === 'request' && (
          <button type="button" onClick={requestMic}>
            {t.requestAllow}
          </button>
        )}
        {micView?.action === 'open-settings' && (
          <button type="button" onClick={() => openSettings('microphone')}>
            {t.openSettings}
          </button>
        )}
      </div>

      <div className="permissions__row">
        <div className="permissions__subject">
          <span className="permissions__name">{t.systemAudioName}</span>
          <span className="permissions__purpose">{t.systemAudioPurpose}</span>
        </div>
        <span className="permissions__state">{t.systemAudioState}</span>
        <button type="button" onClick={() => openSettings('system-audio')}>
          {t.openSettings}
        </button>
      </div>
      <p className="field__hint permissions__hint">{t.hint}</p>
      <div className="permissions__test">
        <button type="button" onClick={runTest} disabled={testing}>
          {testing ? t.testing : t.testButton}
        </button>
        <span className="field__hint">{t.testHint}</span>
      </div>

      {testResult && (
        <ul className="permissions__results" aria-live="polite">
          {testResult.map((row) => (
            <li
              key={row.subject}
              className={
                row.ok ? 'permissions__result permissions__result--ok' : 'permissions__result permissions__result--ng'
              }
            >
              <span className="permissions__result-head">
                <span className="permissions__name">{row.subject}</span>
                <span
                  className={
                    row.ok ? 'permissions__state permissions__state--ok' : 'permissions__state permissions__state--ng'
                  }
                >
                  {row.ok ? t.heard : t.notHeard}
                </span>
              </span>
              {row.message && <span className="permissions__result-message">{row.message}</span>}
              {row.openSettings && (
                <button type="button" onClick={() => row.openSettings && openSettings(row.openSettings)}>
                  {t.openSettings}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
