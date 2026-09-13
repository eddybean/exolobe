import type { VoiceprintDto } from '@shared/ipc'

/**
 * 声紋帳の 1 件に添える説明。
 *
 * 出すのは「どれだけ学習したか」と「最後はいつか」の 2 つ。利用者が消すかどうかを
 * 決める材料はこれで足りる。類似度や次元数を見せても判断は変わらない。
 */
export const voiceprintSummary = (voiceprint: VoiceprintDto): string =>
  `${voiceprint.samples} 回の名付けで学習 ・ ${formatDay(voiceprint.updatedAt)}`

/** 覚えた日。今年なら年を省く（一覧の日時表示と揃える）。 */
const formatDay = (iso: string): string => {
  const date = new Date(iso)
  const sameYear = date.getFullYear() === new Date().getFullYear()

  return new Intl.DateTimeFormat('ja-JP', {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'long',
    day: 'numeric'
  }).format(date)
}
