import type { AppPlatform } from '@shared/platform'
import { localized } from './locale'

const ja = {
  deviceMissing: (platform: AppPlatform): string =>
    platform === 'windows'
      ? 'マイクが見つかりません。マイクがつながっているか、「設定 > システム > サウンド」で入力デバイスに選ばれているかを確認してください。'
      : 'マイクが見つかりません。Mac mini や Mac Studio には内蔵マイクが無いため、外付けマイクを接続してください。',
  permissionDenied: (platform: AppPlatform): string =>
    platform === 'windows'
      ? 'マイクの使用が許可されていません。「設定 > プライバシーとセキュリティ > マイク」で、マイクへのアクセスとデスクトップ アプリのアクセスをオンにしてください。'
      : 'マイクの使用が許可されていません。「システム設定 > プライバシーとセキュリティ > マイク」でこのアプリを許可してください。',
  notReadable: 'マイクを開始できませんでした。他のアプリが使用中でないか確認してください。',
  unavailable: (detail: string) => `マイクを使用できませんでした（${detail}）。`,
  setupFailed: (detail: string) => `マイクの音声処理を初期化できませんでした（${detail}）。`,
  unknownDetail: '原因不明',
  micFallbackWarning: (message: string) => `${message} 相手の音声のみで録音を続けます。`
}

const en: typeof ja = {
  deviceMissing: (platform: AppPlatform): string =>
    platform === 'windows'
      ? 'No microphone was found. Check that a microphone is connected and selected as the input device under Settings > System > Sound.'
      : 'No microphone was found. Mac mini and Mac Studio have no built-in microphone, so connect an external one.',
  permissionDenied: (platform: AppPlatform): string =>
    platform === 'windows'
      ? 'The microphone is not allowed. Under Settings > Privacy & security > Microphone, turn on microphone access and let desktop apps access your microphone.'
      : 'The microphone is not allowed. Allow this app under System Settings > Privacy & Security > Microphone.',
  notReadable: 'Could not start the microphone. Check whether another app is using it.',
  unavailable: (detail: string) => `Could not use the microphone (${detail}).`,
  setupFailed: (detail: string) => `Could not set up microphone audio processing (${detail}).`,
  unknownDetail: 'unknown cause',
  micFallbackWarning: (message: string) => `${message} Recording continues with only the other side’s audio.`
}

/** マイク取得まわり（micErrors / micCapture / startRecordingSession）の文言。 */
export const audioText = localized({ ja, en })
