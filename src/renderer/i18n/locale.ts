import { FALLBACK_LOCALE, localeTag, type Locale } from '@shared/i18n/locale'

/**
 * renderer の UI の言語（ADR-043）。
 *
 * main が起動時に決めた言語を、最初の描画の前に一度だけ受け取る（main.tsx）。アプリが動いている
 * 間は変わらないので、React の context で配らずモジュールに持つ。純粋関数のヘルパー
 * （pipelineProgress.ts など）からも同じように引ける。
 */
let current: Locale = FALLBACK_LOCALE

export const setLocale = (locale: Locale): void => {
  current = locale
}

export const locale = (): Locale => current

/** Intl.DateTimeFormat などに渡すタグ。 */
export const intlLocale = (): string => localeTag(current)

/**
 * 言語ごとの文言の表から、今の言語の方を返す関数を作る。
 *
 * 表の型は ja から導き、en にも同じ型を付けて書く（`const en: typeof ja`）。キーの書き忘れや
 * 余分なキーは型検査で落ちる。
 */
export const localized =
  <T>(table: Readonly<Record<Locale, T>>): (() => T) =>
  () =>
    table[current]
