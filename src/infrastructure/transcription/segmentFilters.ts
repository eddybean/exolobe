/**
 * テキストだけで判断できる関門。エンジンに依らないので、whisper と Haas で共用する（ADR-049）。
 * 確信度やタイムスタンプで判断する関門は、エンジンごとの出力の形に依るので各実装が持つ。
 */

/** セグメントを落とした関門。閾値を見直すには、どこで落ちたかが要る。 */
export type DropReason = 'non-speech' | 'boilerplate' | 'low-confidence' | 'repetition'

/** 落としたセグメントの記録。計測モードでのみ作られる。 */
export interface DroppedSegment {
  readonly speakerId: string
  readonly startMs: number
  readonly endMs: number
  readonly text: string
  readonly reason: DropReason
  /** 確率を持つトークンがあったときだけ入る。 */
  readonly avgLogprob?: number
}

/**
 * 落としたセグメントの通知先。
 *
 * 出力先をここで決めないのは、`console` を持たない呼び出し元（テスト、将来の
 * ファイル出力）からも同じ経路で受け取れるようにするため。
 */
export type DroppedSegmentReporter = (dropped: DroppedSegment) => void

/** whisper が挿入する非発話マーカー。Haas は出さないが、出ても発言ではないので共用する。 */
const NON_SPEECH = /^(\[[^\]]*\]|\([^)]*\)|♪+|＊+)$/

/**
 * 無音区間で whisper が生みやすい定型句。VAD をすり抜けた分の保険。
 *
 * whisper の学習データには字幕が大量に含まれるため、音声が無いと動画の
 * 締めの決まり文句を出力する。セグメント全体がこれらと一致したときだけ
 * 落とす（部分一致で消すと「資料の共有ありがとうございました」のような
 * 本物の発言まで失われる）。
 *
 * 載せるのは動画の文脈でしか出てこない固有性の高い言い回しに限る。
 * 「終わり」のような短く汎用的な語は、会議の締めで実際に発せられたものと
 * 区別がつかず、黙って消すほうが害が大きい。
 */
const HALLUCINATIONS: readonly string[] = [
  'ご視聴ありがとうございました',
  'ご視聴ありがとうございます',
  'ご清聴ありがとうございました',
  'ご清聴ありがとうございます',
  '最後までご視聴いただきありがとうございました',
  'チャンネル登録よろしくお願いします',
  'チャンネル登録高評価よろしくお願いします',
  'この動画が良かったと思ったらチャンネル登録よろしくお願いします',
  '次回の動画でお会いしましょう',
  // 英語の会議でも無音から同じ種類の定型句が生まれる（ADR-043）。比較は小文字で行う。
  'thank you for watching',
  'thanks for watching',
  'thank you so much for watching',
  'thanks for watching and see you next time',
  'please subscribe to my channel',
  'please like and subscribe',
  'see you in the next video'
]

/** 末尾の句読点や感嘆符は揺れるだけで意味を持たないため、比較前に落とす。 */
const stripTrailingPunctuation = (text: string): string => text.replace(/[。．.、，,！!？?〜~…\s]+$/u, '')

/** 英語は文頭の大文字が揺れる。日本語には影響しない。 */
const matches = (list: readonly string[], text: string): boolean =>
  list.includes(stripTrailingPunctuation(text).trim().toLowerCase())

/**
 * セグメントをテキストだけで落とす理由。落とさないなら undefined。
 * `extraBoilerplate` はエンジン固有の定型句（小文字・末尾の句読点なしで書く）。
 */
export const textDropReason = (
  text: string,
  extraBoilerplate: readonly string[] = []
): 'non-speech' | 'boilerplate' | undefined => {
  if (NON_SPEECH.test(text)) return 'non-speech'
  if (matches(HALLUCINATIONS, text) || matches(extraBoilerplate, text)) return 'boilerplate'
  return undefined
}
