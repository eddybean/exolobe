import type { AppleIntelligenceAvailabilityDto } from '@shared/ipc'

export type AppleIntelligenceChoice =
  | { readonly selectable: true }
  | {
      readonly selectable: false
      /** 問い合わせ中は無い。開いた瞬間に「使えません」を点滅させない。 */
      readonly reason?: Exclude<AppleIntelligenceAvailabilityDto, 'available'>
    }

/** 要約のモデルに Apple Intelligence を選べるか（ADR-046）。 */
export const appleIntelligenceChoice = (
  availability: AppleIntelligenceAvailabilityDto | undefined
): AppleIntelligenceChoice => {
  if (availability === undefined) return { selectable: false }
  if (availability === 'available') return { selectable: true }
  return { selectable: false, reason: availability }
}
