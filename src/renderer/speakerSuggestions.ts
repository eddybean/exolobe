/**
 * 話者名を書き換えるときに出す候補（ADR-040）。
 *
 * この会議の予定にいた参加者が最も当たりやすいので先に並べ、声紋帳の名前
 * （過去の録音で名付けた人）を後ろに続ける。候補は入力を補うだけで、
 * 名前を自動で当てることはしない（自動適用は声紋の一致だけ、ADR-031）。
 */
export const speakerNameSuggestions = (params: {
  participants: readonly string[] | undefined
  voiceprintNames: readonly string[]
  currentLabel: string
}): string[] =>
  [...new Set([...(params.participants ?? []), ...params.voiceprintNames])].filter(
    (name) => name !== params.currentLabel
  )
