import type { VoiceprintDto } from '@shared/ipc'

/**
 * 声紋帳の 1 件に添える説明。
 *
 * 出すのは「どれだけ学習したか」と「最後はいつか」の 2 つ。利用者が消すかどうかを
 * 決める材料はこれで足りる。類似度や次元数を見せても判断は変わらない。
 */
export const voiceprintSummary = (voiceprint: VoiceprintDto): string =>
  `${voiceprint.samples} 件の録音から学習 ・ ${formatDay(voiceprint.updatedAt)}`

/**
 * 名前での絞り込み。並びは受け取ったまま（覚えた順）を保つ。
 *
 * 探しているのは「消したい 1 人」なので、あいまい一致や読みの推測はしない ――
 * 意図しない人が混じるより、打った文字がそのまま含まれる人だけが残る方が確かめやすい。
 */
export const filterVoiceprints = (
  entries: readonly VoiceprintDto[],
  query: string
): VoiceprintDto[] => {
  const needle = normalize(query)
  if (needle === '') return [...entries]

  return entries.filter((entry) => normalize(entry.name).includes(needle))
}

/** 設定画面に常時出す件数。一覧を開かなくても規模が分かるようにする。 */
export const voiceprintCountLabel = (count: number): string => `${count} 人を覚えています`

/**
 * 比較用にならす。
 *
 * NFKC は全角で打った英字を半角に寄せるため。日本語の名前に英字が混じるとき、
 * IME の状態次第で全角になるのは利用者の落ち度ではない。
 */
const normalize = (text: string): string => text.trim().normalize('NFKC').toLowerCase()

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
