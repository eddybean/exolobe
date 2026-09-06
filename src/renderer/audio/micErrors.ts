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

/** デバイスが見つからないときに getUserMedia が使う名前（旧称を含む）。 */
const NOT_FOUND = new Set(['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'])

/** 権限で拒否されたときの名前（旧称を含む）。 */
const NOT_ALLOWED = new Set(['NotAllowedError', 'PermissionDeniedError', 'SecurityError'])

export const describeMicFailure = (error: unknown): MicError => {
  const name = error instanceof Error ? error.name : ''
  const options = { cause: error }

  if (NOT_FOUND.has(name)) {
    return new MicDeviceMissingError(
      // 録音を続けるかどうかは呼び出し側の方針なので、ここでは原因だけを述べる。
      'マイクが見つかりません。Mac mini や Mac Studio には内蔵マイクが無いため、' +
        '外付けマイクを接続してください。',
      options
    )
  }

  if (NOT_ALLOWED.has(name)) {
    return new MicPermissionError(
      'マイクの使用が許可されていません。「システム設定 > プライバシーとセキュリティ > マイク」で' +
        'このアプリを許可してください。',
      options
    )
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return new MicUnavailableError(
      'マイクを開始できませんでした。他のアプリが使用中でないか確認してください。',
      options
    )
  }

  return new MicUnavailableError(`マイクを使用できませんでした（${detailOf(error)}）。`, options)
}

const detailOf = (error: unknown): string => {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  return '原因不明'
}
