import { globalShortcut } from 'electron'
import { RECORDING_SHORTCUT } from '@shared/shortcuts'

/**
 * 設定に合わせて登録し直す。登録できたかを返す。
 *
 * 他のアプリが先に同じキーを取っていると登録は黙って失敗する。呼び出し側が失敗を
 * 知れるよう、結果を握り潰さずに返す。
 */
export const applyRecordingShortcut = (enabled: boolean, onPress: () => void): boolean => {
  if (globalShortcut.isRegistered(RECORDING_SHORTCUT.accelerator))
    globalShortcut.unregister(RECORDING_SHORTCUT.accelerator)
  if (!enabled) return true
  return globalShortcut.register(RECORDING_SHORTCUT.accelerator, onPress)
}
