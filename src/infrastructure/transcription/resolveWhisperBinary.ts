/**
 * whisper-cli の実体を解決する。
 *
 * 配布版では resources/bin に同梱したバイナリを使う（whisper.cpp は macOS 向けの
 * CLI を配布しておらず、利用者に Homebrew を求めないため、パッケージ時にビルドして
 * 同梱している）。開発中は同梱物が無いので、設定値＝`whisper-cli` として PATH から
 * 探す従来どおりの動きになる。
 *
 * 利用者が設定でパスを明示した場合はそれを最優先する。手元でビルドした版や
 * 別バージョンを使いたいケースを塞がないため。
 */
export const resolveWhisperBinary = (params: {
  /** 設定に書かれた値。既定は 'whisper-cli'。 */
  configured: string
  /** 同梱バイナリのパス。存在しない場合は undefined。 */
  bundled?: string
}): string => {
  const configured = params.configured.trim()

  // 既定値のままなら、同梱バイナリがあればそちらを使う。
  const isDefault = configured === '' || configured === 'whisper-cli'
  if (isDefault && params.bundled) return params.bundled

  return configured || 'whisper-cli'
}
