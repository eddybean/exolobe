/** Electron の systemPreferences のうち、マイクの許可に使う部分。テストで差し替えられるように型だけ持つ。 */
export interface MediaAccessPreferences {
  getMediaAccessStatus(mediaType: 'microphone'): string
  askForMediaAccess(mediaType: 'microphone'): Promise<boolean>
}

/**
 * マイクの許可を求める。
 *
 * askForMediaAccess は macOS にしか無い。Windows はアプリから許可のダイアログを出す手段が無く、
 * 設定アプリでの許可がそのまま効く（初めてマイクを使うときに OS が尋ねる）。そこで Windows では
 * 今の状態が許可済みかだけを返し、許可が無ければ画面の案内から設定アプリを開いてもらう（ADR-048）。
 */
export const requestMicPermission = async (
  preferences: MediaAccessPreferences,
  platform: NodeJS.Platform = process.platform
): Promise<boolean> =>
  platform === 'darwin'
    ? preferences.askForMediaAccess('microphone')
    : preferences.getMediaAccessStatus('microphone') === 'granted'
