import { audioText } from '../i18n/audio'
import { platform } from '../platform'

/**
 * マイク取得の失敗を、利用者が次に取るべき操作へつながる形に分類する。
 *
 * すべてを「権限を許可してください」と案内していたことがあったが、マイクが
 * そもそも接続されていない場合、そのアプリは「システム設定 > プライバシーと
 * セキュリティ > マイク」に現れない。存在しない項目を探させてしまうため、
 * 原因ごとに言い分ける。
 */

export class MicError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions)
    this.name = new.target.name
  }
}

/** 入力デバイスが 1 つも無い。Mac mini / Mac Studio には内蔵マイクが無い。 */
export class MicDeviceMissingError extends MicError {}

/** OS またはブラウザに拒否された。 */
export class MicPermissionError extends MicError {}

/** 他アプリの占有など、上記以外の理由で使えない。 */
export class MicUnavailableError extends MicError {}

/** 取得はできたが、音声処理の準備に失敗した（CSP や AudioWorklet の問題）。 */
export class MicSetupError extends MicError {}

/** デバイスが見つからないときに getUserMedia が使う名前（旧称を含む）。 */
const NOT_FOUND = new Set(['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'])

/** 権限で拒否されたときの名前（旧称を含む）。 */
const NOT_ALLOWED = new Set(['NotAllowedError', 'PermissionDeniedError', 'SecurityError'])

export const describeMicFailure = (error: unknown): MicError => {
  const name = error instanceof Error ? error.name : ''
  const options = { cause: error }
  const t = audioText()

  if (NOT_FOUND.has(name)) {
    // 録音を続けるかどうかは呼び出し側の方針なので、ここでは原因だけを述べる。
    return new MicDeviceMissingError(t.deviceMissing(platform()), options)
  }

  if (NOT_ALLOWED.has(name)) {
    return new MicPermissionError(t.permissionDenied(platform()), options)
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return new MicUnavailableError(t.notReadable, options)
  }

  return new MicUnavailableError(t.unavailable(detailOf(error)), options)
}

export const detailOf = (error: unknown): string => {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  return audioText().unknownDetail
}
