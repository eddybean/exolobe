import type { VoiceLearnedDto } from '@shared/ipc'
import { libraryText } from '../i18n/library'

/**
 * 声紋を覚えられなかったことを画面に出す文面。覚えられたときは何も言わない。
 *
 * 黙って捨てると、利用者から見える手がかりは「設定の『覚えた声』に何も増えない」
 * だけになる。名前は付いているので画面上は成功したように見え、次の録音で
 * 「参加者A」に戻って初めて気付く。
 */
export const voiceLearnedNotice = (event: VoiceLearnedDto): string | undefined => {
  if (event.status === 'remembered' || event.status === 'skipped-self') return undefined

  const text = libraryText().voiceLearned
  const head = text.notRemembered(event.label)
  return event.message ? text.withMessage(head, event.message) : text.withoutMessage(head)
}
