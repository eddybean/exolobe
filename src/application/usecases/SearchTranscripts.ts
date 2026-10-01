import type { RecordingArtifactPort, RecordingRepositoryPort } from '@application/ports'
import {
  DEFAULT_MATCHES_PER_RECORDING,
  matchTranscript,
  parseKeywordQuery,
  type HighlightRange
} from '@domain/TranscriptKeywordSearch'

/** 文字起こしの本文に語がそろった発言 1 件。 */
export interface TranscriptHit {
  readonly recordingId: string
  readonly title: string
  readonly startedAt: Date
  /** 録音開始からの相対ミリ秒。詳細画面はここへ飛ぶ。 */
  readonly startMs: number
  readonly speakerLabel: string
  readonly excerpt: string
  readonly ranges: readonly HighlightRange[]
}

/** 一覧に出す件数の既定の上限。 */
export const DEFAULT_TRANSCRIPT_HIT_LIMIT = 50

export interface SearchTranscriptsDeps {
  readonly repository: RecordingRepositoryPort
  readonly artifacts: RecordingArtifactPort
}

/**
 * 文字起こしの本文をそのまま引くキーワード検索。
 *
 * 推論を使わないので意味検索が無効でも動き、意味検索が苦手な固有名詞や型番の
 * 「まさにその語」を拾う。索引は持たず都度 `transcript.json` を読む
 * —— 索引に本文を複製しない方針（ADR-029）を、複製しないことで満たす。
 */
export class SearchTranscripts {
  constructor(private readonly deps: SearchTranscriptsDeps) {}

  async execute(params: { query: string; limit?: number; perRecording?: number }): Promise<TranscriptHit[]> {
    const terms = parseKeywordQuery(params.query)
    if (terms.length === 0) return []

    const limit = params.limit ?? DEFAULT_TRANSCRIPT_HIT_LIMIT
    const perRecording = params.perRecording ?? DEFAULT_MATCHES_PER_RECORDING
    const { repository, artifacts } = this.deps

    const hits: TranscriptHit[] = []
    // list() は新しい順。上限で打ち切るので、読むファイルも新しい方から順に減る。
    for (const recording of await repository.list()) {
      if (hits.length >= limit) break

      const transcript = await artifacts.readTranscript(recording)
      if (!transcript) continue

      const labels = new Map(transcript.speakers.map((speaker) => [speaker.id, speaker.label]))
      const room = Math.min(perRecording, limit - hits.length)
      for (const match of matchTranscript(transcript.segments, terms, room)) {
        hits.push({
          recordingId: recording.id,
          title: recording.title,
          startedAt: recording.startedAt,
          startMs: match.startMs,
          // 話者クラスタが増えて speakers に無い id が来ることがある。空欄にせず id を出す。
          speakerLabel: labels.get(match.speakerId) ?? match.speakerId,
          excerpt: match.excerpt,
          ranges: match.ranges
        })
      }
    }

    return hits
  }
}
