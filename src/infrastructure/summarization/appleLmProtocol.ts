import type {
  AppleIntelligenceAvailability,
  AppleIntelligenceStatus
} from '@domain/AppleIntelligence'

/**
 * applelm（native/applelm/main.swift）との取り決め。
 *
 * `status` は `{"availability":"available","contextSize":8192}` のような JSON を 1 行出す。
 * 読めないもの・知らない理由は「使えない」に倒す。使えると誤って読むと、要約のたびに失敗する。
 */

const REPORTED: readonly AppleIntelligenceAvailability[] = [
  'available',
  'unsupported-os',
  'device-not-eligible',
  'apple-intelligence-not-enabled',
  'model-not-ready',
  'unavailable'
]

export const isReportedAvailability = (value: unknown): value is AppleIntelligenceAvailability =>
  REPORTED.includes(value as AppleIntelligenceAvailability)

const UNAVAILABLE: AppleIntelligenceStatus = { availability: 'unavailable' }

export const parseAppleLmStatus = (stdout: string): AppleIntelligenceStatus => {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return UNAVAILABLE
  }
  if (typeof parsed !== 'object' || parsed === null) return UNAVAILABLE

  const { availability, contextSize } = parsed as Record<string, unknown>
  if (!isReportedAvailability(availability)) return UNAVAILABLE
  if (availability !== 'available') return { availability }
  // コンテキスト長が分からないと分割の大きさを決められない。
  if (typeof contextSize !== 'number' || !Number.isInteger(contextSize) || contextSize <= 0) {
    return UNAVAILABLE
  }
  return { availability, contextSize }
}

/** respond の終了コード。main.swift と揃える。 */
export const RESPOND_EXIT = {
  unavailable: 2,
  rejected: 3,
  contextExceeded: 4,
  unsupportedLanguage: 5
} as const
