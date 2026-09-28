import { setAppLocale } from '../src/main/i18n'
import { setLocale } from '../src/renderer/i18n/locale'

/**
 * テストは日本語の UI で動かす。既存のテストが日本語の文言で期待値を書いているため。
 * 英語の文言を確かめるテストは、その中で言語を切り替えて戻す。
 */
setAppLocale('ja')
setLocale('ja')
