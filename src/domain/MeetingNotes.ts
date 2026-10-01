import type { MeetingLanguage } from '@domain/MeetingLanguage'
import type { Speaker } from '@domain/Speaker'
import { formatTimestamp } from '@domain/Transcript'
import type { TranscriptSegment } from '@domain/TranscriptSegment'

/**
 * 録音中に書いたメモの 1 行。`atMs` は書き始めた時点の録音開始からの経過ミリ秒。
 *
 * 時刻は note.md の本文に `[hh:mm:ss]` として埋める（ADR-042）。別ファイルに持つと、
 * 録音後にメモを書き換えたときに行との対応が崩れる。
 */
export interface NoteLine {
  readonly text: string
  readonly atMs?: number
}

/** 録音中に「今の発言に印をつける」を押した時点。 */
export interface Bookmark {
  readonly atMs: number
}

/** 行頭の字下げと箇条書きの記号。時刻はこの後ろに埋める（Markdown の箇条書きを崩さない）。 */
const LEAD = /^(\s*(?:(?:[-*+]|\d+\.)(?:\s+|$))?)/
const STAMPED = /^(\s*(?:(?:[-*+]|\d+\.)\s+)?)\[(?:(\d+):)?(\d{1,2}):(\d{2})\] ?(.*)$/

const pad = (value: number): string => String(value).padStart(2, '0')

/** メモに埋める時刻。長さの違う会議でも桁が揃うよう、1 時間未満でも時を出す。 */
export const formatNoteStamp = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`
}

/** 箇条書きの記号を除いた中身。記号だけの行はまだ書き始めていない。 */
const contentOf = (text: string): string => text.replace(LEAD, '').trim()

const withStamp = (text: string, atMs: number | undefined): NoteLine => (atMs === undefined ? { text } : { text, atMs })

/**
 * 編集後の本文に、行ごとの書き始めの時刻を引き継ぐ。
 *
 * 前後の変わらない行を突き合わせ、間の変わった行だけを見る。書き足した行は元の時刻の
 * まま、新しく書き始めた行だけに `atMs` を付ける。打鍵のたびに呼ばれるので、変更は
 * ほぼ 1 か所に集まる前提で単純な前後一致にしている。
 */
export const stampLines = (previous: readonly NoteLine[], text: string, atMs: number): NoteLine[] => {
  const next = text.split('\n')
  const limit = Math.min(previous.length, next.length)

  let head = 0
  while (head < limit && previous[head]?.text === next[head]) head += 1
  let tail = 0
  while (tail < limit - head && previous[previous.length - 1 - tail]?.text === next[next.length - 1 - tail]) {
    tail += 1
  }

  const changedBefore = previous.slice(head, previous.length - tail)
  const changedAfter = next.slice(head, next.length - tail).map((line, index) => {
    if (contentOf(line) === '') return { text: line }
    return withStamp(line, changedBefore[index]?.atMs ?? atMs)
  })

  return [...previous.slice(0, head), ...changedAfter, ...previous.slice(previous.length - tail)]
}

/** note.md の本文にする。時刻は箇条書きの記号の後ろに `[hh:mm:ss]` で埋める。 */
export const serializeNote = (lines: readonly NoteLine[]): string =>
  lines
    .map(({ text, atMs }) => {
      if (atMs === undefined) return text
      const lead = LEAD.exec(text)?.[1] ?? ''
      return `${lead}[${formatNoteStamp(atMs)}] ${text.slice(lead.length)}`
    })
    .join('\n')

/** note.md を行に戻す。`[mm:ss]` も読む（録音後に手で書き足した時刻）。 */
export const parseNote = (markdown: string): NoteLine[] =>
  markdown.split('\n').map((line) => {
    const match = STAMPED.exec(line)
    if (!match) return { text: line }
    const [, lead = '', hours = '0', minutes = '0', seconds = '0', rest = ''] = match
    const atMs = (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000
    return { text: `${lead}${rest}`, atMs }
  })

/** 詳細画面で時刻から飛べるよう、時刻つきの行を本文と一緒に取り出す。 */
export const noteMoments = (markdown: string): Array<{ atMs: number; text: string }> =>
  parseNote(markdown).flatMap((line) => {
    const text = contentOf(line.text)
    return line.atMs === undefined || text === '' ? [] : [{ atMs: line.atMs, text }]
  })

/**
 * 要約の入力に足す見出しと説明。要約プロンプトと同じく会議の言語で書く（ADR-043）。
 * 英語の要約プロンプトに日本語の節が混ざると、要約の一部が日本語で返ってくる。
 */
const NOTES_TEXT: Readonly<
  Record<
    MeetingLanguage,
    {
      readonly memoHeading: string
      readonly memoGuide: string
      readonly marksHeading: string
      readonly marksGuide: string
      readonly quote: (speaker: string, text: string) => string
    }
  >
> = {
  ja: {
    memoHeading: '## 会議中のメモ',
    memoGuide: '利用者が会議中に書いたメモです。ここにある論点は要約から落とさないでください。',
    marksHeading: '## 重要だと印をつけた発言',
    marksGuide: '利用者が会議中に「ここは重要」と印をつけた箇所です。要約で優先して扱ってください。',
    quote: (speaker, text) => `${speaker}「${text}」`
  },
  en: {
    memoHeading: '## Notes taken during the meeting',
    memoGuide: 'Notes the user wrote during the meeting. Do not leave the points raised here out of the minutes.',
    marksHeading: '## Moments marked as important',
    marksGuide: 'Places the user marked as important during the meeting. Give them priority in the minutes.',
    quote: (speaker, text) => `${speaker}: “${text}”`
  }
}

/** 印を押すのは聞いてから。押した時点で話し終わっていた発言も拾う。 */
const MARK_LOOKBACK_MS = 15_000

/**
 * 要約プロンプトの `{{notes}}` に入れる素材。メモも印も無ければ空文字。
 *
 * 印には押した時点の発言を添える。時刻だけ渡して文字起こしと突き合わせさせると、
 * 4B のモデルはしばしば外し、外したことが出力から見えない（ADR-032 と同じ理由）。
 */
export const summaryNotes = (params: {
  note: string
  marks: readonly Bookmark[]
  segments: readonly TranscriptSegment[]
  speakers: readonly Speaker[]
  language: MeetingLanguage
}): string => {
  const text = NOTES_TEXT[params.language]
  const labels = new Map(params.speakers.map((speaker) => [speaker.id, speaker.label]))
  const sections: string[] = []

  const memo = params.note.trim()
  if (memo) {
    sections.push([text.memoHeading, text.memoGuide, memo].join('\n'))
  }

  if (params.marks.length > 0) {
    const lines = [...params.marks]
      .sort((a, b) => a.atMs - b.atMs)
      .map(({ atMs }) => {
        const spoken = params.segments
          .filter((segment) => segment.startMs <= atMs && segment.endMs >= atMs - MARK_LOOKBACK_MS)
          .map((segment) => text.quote(labels.get(segment.speakerId) ?? segment.speakerId, segment.text))
        return `- [${formatTimestamp(atMs)}]${spoken.length > 0 ? ` ${spoken.join(' ')}` : ''}`
      })
    sections.push([text.marksHeading, text.marksGuide, ...lines].join('\n'))
  }

  return sections.join('\n\n')
}
