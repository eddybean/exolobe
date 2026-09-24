/**
 * テスト録音（録音に必要な許可の確認）の決まりごと。
 *
 * システム音声（Core Audio Tap）は許可を問い合わせる公開 API が無く、許可が無くても
 * エラーにならず、ぴったり 0 の無音が流れるだけになる。そこでアプリ自身が確認音を
 * 鳴らし、それが取れたかで許可を見分ける。何も鳴っていない Mac では、許可があっても
 * 無くても同じ無音になり、見分けられないため。
 */
export const INPUT_CHECK = {
  /** システム音声を取り込む長さ。 */
  durationMs: 3_000,
  /** 確認音を鳴らし始めるまでの間。取り込みが動き出す前に鳴り終えないように空ける。 */
  toneStartMs: 700,
  /** 確認音を鳴らす長さ。取り込みが終わる前に鳴り終える。 */
  toneDurationMs: 1_600,
  /**
   * 「音が入った」とみなす振幅（0〜1）。確認音は約 0.15 で鳴らす。許可が無いときの
   * 無音はぴったり 0、静かな部屋のマイクの雑音はこれより小さい。
   */
  audibleThreshold: 0.02
} as const

export type InputVerdict = 'heard' | 'silent'

export const judgeInput = (peak: number): InputVerdict =>
  peak >= INPUT_CHECK.audibleThreshold ? 'heard' : 'silent'
