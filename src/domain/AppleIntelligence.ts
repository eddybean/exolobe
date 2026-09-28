/**
 * Apple Intelligence（macOS の FoundationModels）が要約に使えるか（ADR-046）。
 *
 * 使えない理由ごとに、利用者が打てる手が違う（OS を上げる・設定で有効にする・準備を待つ）。
 * 画面で案内を出し分けるので、理由を潰さずに運ぶ。
 */
export type AppleIntelligenceAvailability =
  | 'available'
  /** macOS 27 未満。評価したのは 27 のモデルなので、それ未満では使わせない。 */
  | 'unsupported-os'
  /** Apple Intelligence に対応しない Mac。 */
  | 'device-not-eligible'
  /** システム設定で Apple Intelligence が有効になっていない。 */
  | 'apple-intelligence-not-enabled'
  /** モデルのダウンロードや準備が終わっていない。 */
  | 'model-not-ready'
  /** 上のどれでもない理由で使えない。 */
  | 'unavailable'
  /** 同梱の applelm が無い（開発環境でまだ作っていないなど）。 */
  | 'missing'

export interface AppleIntelligenceStatus {
  readonly availability: AppleIntelligenceAvailability
  /** 使えるときだけ。分割の大きさを決めるのに使う。 */
  readonly contextSize?: number
}
