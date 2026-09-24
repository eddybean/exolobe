import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { MicPermissionDto, PrivacyPaneDto } from '@shared/ipc'
import { messageOf } from '../errorMessage'
import { micPermissionView } from '../permissions'

/**
 * 録音に必要な 2 つの許可（マイク・システム音声）の状態と、直し方への入口。
 *
 * マイクは macOS に状態を問い合わせられる。システム音声（Core Audio Tap、ADR-001）は
 * 問い合わせる公開 API が無く、許可が無くてもエラーにならず無音が流れるだけなので、
 * 状態は出さず、どこで確かめればよいかを案内する。
 */
export const RecordingPermissions = (): ReactElement => {
  const [mic, setMic] = useState<MicPermissionDto>()
  const [error, setError] = useState<string>()

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

  const micView = mic === undefined ? undefined : micPermissionView(mic)

  return (
    <section className="settings-card permissions" aria-labelledby="permissions-title">
      <h3 id="permissions-title" className="settings-card__title">
        録音に必要な許可
      </h3>

      {error && (
        <p className="settings__error" role="alert">
          {error}
        </p>
      )}

      <div className="permissions__row">
        <div className="permissions__subject">
          <span className="permissions__name">マイク</span>
          <span className="permissions__purpose">自分の声</span>
        </div>
        {micView && (
          <span className={micView.ok ? 'permissions__state permissions__state--ok' : 'permissions__state permissions__state--ng'}>
            {micView.label}
          </span>
        )}
        {micView?.action === 'request' && (
          <button type="button" onClick={requestMic}>
            許可する
          </button>
        )}
        {micView?.action === 'open-settings' && (
          <button type="button" onClick={() => openSettings('microphone')}>
            システム設定を開く
          </button>
        )}
      </div>

      <div className="permissions__row">
        <div className="permissions__subject">
          <span className="permissions__name">システム音声</span>
          <span className="permissions__purpose">相手の声</span>
        </div>
        <span className="permissions__state">アプリからは確認できません</span>
        <button type="button" onClick={() => openSettings('system-audio')}>
          システム設定を開く
        </button>
      </div>
      {/* 文の間で改行すると JSX が空白を挟むので、文ごとに文字列で渡す。 */}
      <p className="field__hint permissions__hint">
        {'初めて録音するときに macOS が許可を求めます。許可が無くてもエラーにはならず、相手の声が無音のまま録音されます。'}
        {'システム設定の「画面収録とシステムオーディオ録音」にある「システムオーディオ録音のみ」で、このアプリがオンになっていれば問題ありません。'}
      </p>
    </section>
  )
}
