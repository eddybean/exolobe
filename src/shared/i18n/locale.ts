/**
 * UI の言語（ADR-043）。
 *
 * 会議の言語（文字起こし・要約・チャット）とは別物。英語 UI で日本語の会議を録る人もいるため、
 * こちらは画面・メニュー・通知・エラーの文言だけを決める。
 */
export const LOCALES = ['ja', 'en'] as const
export type Locale = (typeof LOCALES)[number]

/** 優先言語のどれにも対応していないときの言語。日本語話者以外には英語の方が読める見込みが高い。 */
export const FALLBACK_LOCALE: Locale = 'en'

/**
 * macOS の優先言語（先頭が最優先）から UI の言語を決める。
 *
 * 先頭だけを見ず、対応している最初の言語を採る。macOS が Bundle の .lproj を選ぶのと同じ
 * 規則にしないと、許可ダイアログ（InfoPlist.strings）と画面の言語が食い違う。
 */
export const resolveLocale = (preferred: readonly string[]): Locale => {
  for (const tag of preferred) {
    const language = tag.toLowerCase().split(/[-_]/)[0]
    const found = LOCALES.find((locale) => locale === language)
    if (found) return found
  }
  return FALLBACK_LOCALE
}

/** Intl（日付・数値の書式）に渡すタグ。 */
export const localeTag = (locale: Locale): string => (locale === 'ja' ? 'ja-JP' : 'en-US')

const LOCALE_ARG = '--omr-locale='

/**
 * main が決めた言語を renderer へ渡す引数（BrowserWindow の additionalArguments）。
 *
 * renderer は描画の前に言語を知っている必要がある。IPC で問い合わせると最初の描画を
 * 待たせるか、一瞬だけ別の言語で描くことになるので、起動引数で同期的に渡す。
 */
export const localeArg = (locale: Locale): string => `${LOCALE_ARG}${locale}`

export const localeFromArgv = (argv: readonly string[]): Locale => {
  const value = argv.find((arg) => arg.startsWith(LOCALE_ARG))?.slice(LOCALE_ARG.length)
  return LOCALES.find((locale) => locale === value) ?? FALLBACK_LOCALE
}
