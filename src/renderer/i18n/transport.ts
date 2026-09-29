import { localized } from './locale'

/** 画面下部の操作バー（TransportBar）の文言。 */

const ja = {
  startRecording: '録音を開始',
  stopRecording: '録音を停止',
  processing: '処理中…',
  stop: '停止',
  record: '録音',
  shortcutHint: 'どのアプリを見ていても録音を開始・停止できます',
  idle: '待機中',
  silenceAlert: (minutes: number): string => `${minutes} 分以上、音が入っていません。録音を停止しますか？`,
  stopButton: '停止する',
  keepRecording: '続ける',
  stopAndDiscard: '停止して破棄',
  /** startAlertMessage（shared/startAlert.ts）の本文に続けて置く一言。 */
  startAlertSuffix: '録音を開始しますか？',
  startNow: '録音する',
  skipForNow: '今はしない',
  meterTitle: '入力レベルの推移（上：デスクトップ音声＝相手 / 下：マイク＝自分、直近 10 秒）',
  dismissError: 'エラーを閉じる'
}

const en: typeof ja = {
  startRecording: 'Start Recording',
  stopRecording: 'Stop Recording',
  processing: 'Processing…',
  stop: 'Stop',
  record: 'Record',
  shortcutHint: 'Start or stop recording from any app.',
  idle: 'Idle',
  silenceAlert: (minutes: number): string =>
    `No audio detected for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} or more. Stop recording?`,
  stopButton: 'Stop',
  keepRecording: 'Keep Recording',
  stopAndDiscard: 'Stop and Discard',
  startAlertSuffix: ' Start recording?',
  startNow: 'Record',
  skipForNow: 'Not Now',
  meterTitle: 'Input level, last 10 seconds (top: system audio = them / bottom: microphone = you)',
  dismissError: 'Dismiss error'
}

export const transportText = localized({ ja, en })
