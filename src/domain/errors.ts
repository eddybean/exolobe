/** アプリが利用者に提示できる日本語メッセージを持つエラーの基底。 */
export class AppError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions)
    this.name = new.target.name
  }
}

/** 設定不足など、利用者の操作で解消できる状態。 */
export class ConfigurationError extends AppError {}

/** 録音の開始・停止が現在の状態では行えない。 */
export class RecordingStateError extends AppError {}

/** 指定された録音が存在しない。 */
export class RecordingNotFoundError extends AppError {
  constructor(readonly recordingId: string) {
    super(`録音が見つかりません: ${recordingId}`)
  }
}

/** パイプラインの 1 ステップが失敗した。 */
export class PipelineStepError extends AppError {}

/** 例外値から利用者向けメッセージを取り出す。catch した unknown を安全に扱う。 */
export const toMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}
