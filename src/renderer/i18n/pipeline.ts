import { localized } from './locale'

const ja = {
  /** どのステップも動いていないとき（ワーカーが他の録音を先に捌いている間）。 */
  queued: '処理待ち',
  /** タイトル下のピル本体。label はステップ名、fraction/remaining は前に空白付きで足す断片。 */
  running: (label: string, fraction: string, remaining: string) => `${label}中${fraction}${remaining}`,
  remainingUnderMinute: '残り 1 分未満',
  remainingAbout: (minutes: number) => `残り約 ${minutes} 分`,
  /** 割合と残り時間の間の区切り。全角の中点で日本語の文章に馴染ませる。 */
  separator: ' ・ '
}

const en: typeof ja = {
  queued: 'Queued',
  running: (label: string, fraction: string, remaining: string) => `${label}${fraction}${remaining}`,
  remainingUnderMinute: 'Less than 1 min left',
  remainingAbout: (minutes: number) => `about ${minutes} min left`,
  separator: ' · '
}

/** タイトル下のピル（処理状況）の文言。 */
export const pipelineText = localized({ ja, en })
