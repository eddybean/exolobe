/** 文字起こしの最小単位。時刻は録音開始からの相対ミリ秒。 */
export interface TranscriptSegment {
  readonly startMs: number
  readonly endMs: number
  readonly speakerId: string
  readonly text: string
}

/** 話者ダイアライゼーションが返す発話区間。 */
export interface SpeakerTurn {
  readonly startMs: number
  readonly endMs: number
  /** ダイアライザが割り当てたクラスタ名（例: `spk0`）。 */
  readonly speaker: string
}
