import type { AppleIntelligenceAvailability } from '@domain/AppleIntelligence'
import type { Locale } from './locale'

type Unavailable = Exclude<AppleIntelligenceAvailability, 'available'>

/**
 * Apple Intelligence が使えない理由と、利用者が打てる手（ADR-046）。
 *
 * 要約の失敗（ステップの理由）と設定画面の両方が引くので shared に置く。
 */
const UNAVAILABLE: Readonly<Record<Locale, Readonly<Record<Unavailable, string>>>> = {
  ja: {
    'unsupported-os': 'Apple Intelligence での要約には macOS 27 以降が必要です。',
    'device-not-eligible': 'この Mac は Apple Intelligence に対応していません。',
    'apple-intelligence-not-enabled':
      'Apple Intelligence が有効になっていません。「システム設定 > Apple Intelligence と Siri」で有効にしてください。',
    'model-not-ready': 'Apple Intelligence のモデルを準備中です。しばらく待ってからやり直してください。',
    unavailable: 'Apple Intelligence を使えません。',
    missing: 'Apple Intelligence を呼び出すプログラム（applelm）が見つかりません。'
  },
  en: {
    'unsupported-os': 'Summarizing with Apple Intelligence requires macOS 27 or later.',
    'device-not-eligible': 'This Mac does not support Apple Intelligence.',
    'apple-intelligence-not-enabled':
      'Apple Intelligence is turned off. Turn it on in System Settings > Apple Intelligence & Siri.',
    'model-not-ready': 'The Apple Intelligence model is still being prepared. Wait a while and try again.',
    unavailable: 'Apple Intelligence is not available.',
    missing: 'The program that calls Apple Intelligence (applelm) was not found.'
  }
}

export const appleIntelligenceUnavailableText = (availability: Unavailable, locale: Locale): string =>
  UNAVAILABLE[locale][availability]
