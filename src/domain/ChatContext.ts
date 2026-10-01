import type { SpeakerScope, SummarySection } from '@domain/ChatQuery'
import { isRemoteSpeakerId, SELF_SPEAKER_ID, type Speaker } from '@domain/Speaker'
import { formatTimestamp } from '@domain/Transcript'
import type { TranscriptSegment } from '@domain/TranscriptSegment'
import type { MeetingLanguage } from '@domain/MeetingLanguage'

/**
 * 選ばれた録音から、モデルに読ませる文脈を組み立てる純粋な計算。
 *
 * コンテキストに入る量は決まっているので、「何を載せて何を落としたか」を
 * 数えて返すところまでがこの計算の仕事。落とした事実を伝えないと、
 * モデルは全部を見た前提で断定する。
 */

export interface ChatSourceMaterial {
  readonly recordingId: string
  readonly title: string
  readonly startedAt: Date
  readonly summary?: string
  readonly segments: readonly TranscriptSegment[]
  readonly speakers: readonly Speaker[]
}

export interface ChatCitation {
  readonly recordingId: string
  readonly title: string
  readonly startedAt: Date
  readonly source: 'summary' | 'transcript'
  /** 文字起こしを載せた場合の、その範囲の先頭時刻。 */
  readonly startMs?: number
  readonly truncated: boolean
}

export interface ChatContext {
  readonly text: string
  readonly citations: readonly ChatCitation[]
  /** 予算に入りきらず載せなかった録音の数。 */
  readonly droppedCount: number
}

/**
 * 1 トークンに収まる日本語の文字数の概算。
 *
 * **少なめに見るのが安全側**。文字数の予算はこの値を掛けて出すので、大きく見積もる
 * ほど多くの文字を通してしまう。日本語は漢字・かなが 1 文字 1 トークン、珍しい字は
 * 2 トークン以上になるため、1 を超える値は必ずコンテキストを溢れさせる。
 *
 * LlamaCppSummarizer の同名定数（1.5）とは共有しない。あちらを動かすと既存の要約の
 * 分割挙動が変わるため。
 */
export const CHARS_PER_TOKEN = 0.8

/** 回答のために空けておくトークン数。NodeLlamaChatSessionFactory の maxTokens と揃える。 */
export const ANSWER_TOKENS = 2_048

/** システム指示とテンプレートのぶん。 */
export const INSTRUCTION_TOKENS = 512

/**
 * 1 録音に最低これだけは割く。下回るなら載せない。
 *
 * 数百字に満たない断片は、要約としても引用としても役に立たないうえ、
 * 「その会議には何も無かった」とモデルに誤読させる。
 */
export const MIN_PER_RECORDING_CHARS = 400

/**
 * 文脈に添える注記。指示文と同じく問いの言語で書く（ADR-043）。指示文と文脈の言語が
 * ずれると、4B のモデルは答えの言語まで揺れる。
 */
const CONTEXT_TEXT: Readonly<
  Record<
    MeetingLanguage,
    {
      readonly omission: string
      readonly weekdays: readonly string[]
      readonly date: (isoDate: string, weekday: string) => string
      readonly summary: string
      readonly transcript: (scope: SpeakerScope) => string
      readonly dropped: (total: number, kept: number) => string
    }
  >
> = {
  ja: {
    omission: '…（以下省略）',
    weekdays: ['日', '月', '火', '水', '木', '金', '土'],
    date: (isoDate, weekday) => `${isoDate}（${weekday}）`,
    summary: '（要約）',
    transcript: (scope) =>
      `（${
        scope === 'self'
          ? '自分の発言のみ・文字起こし'
          : scope === 'remote'
            ? '相手の発言のみ・文字起こし'
            : '文字起こし'
      }）`,
    dropped: (total, kept) => `※ 対象は ${total} 件ありましたが、長さの都合で新しい ${kept} 件だけを載せています。`
  },
  en: {
    omission: '… (rest omitted)',
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    date: (isoDate, weekday) => `${isoDate} (${weekday})`,
    summary: '(summary)',
    transcript: (scope) =>
      scope === 'self'
        ? '(your remarks only, transcript)'
        : scope === 'remote'
          ? "(other participants' remarks only, transcript)"
          : '(transcript)',
    dropped: (total, kept) =>
      `Note: ${total} meetings matched, but only the newest ${kept} are included because of length.`
  }
}

/**
 * 議事録の見出しから節を見分ける語。
 *
 * 要約の構成（DEFAULT_SUMMARY_PROMPT）は利用者が書き換えられるので、見出しの文字列を
 * 決め打ちにせず語で当てる。当たらなければ絞らない —— 見つからないことを理由に
 * 中身を落とすと、答えに要る記述ごと消える。
 */
const SECTION_HEADINGS: Record<SummarySection, RegExp> = {
  todo: /todo|to ?do|to-do|action items?|tasks?|next steps|タスク|やること|アクション|宿題|次に(?:やる|する)/i,
  decision: /決定|決まった|決め事|合意|結論|decisions?|agreed|conclusions?/i,
  overview: /概要|要点|サマリ|overview|summary|key points/i,
  discussion: /議論|流れ|経緯|やり取り|discussion/i
}

/**
 * 要約から、名指しされた節だけを見出しごと取り出す。
 *
 * 見出しを落とさないのは、何の一覧なのかをモデルが取り違えないようにするため。
 * 該当が無ければ undefined を返し、呼び出し側は全体を載せる。
 */
export const extractSummarySection = (summary: string, section: SummarySection): string | undefined => {
  const pattern = SECTION_HEADINGS[section]
  const lines = summary.split('\n')
  const start = lines.findIndex((line) => /^#{1,6}\s/.test(line) && pattern.test(line))
  if (start === -1) return undefined

  const rest = lines.slice(start + 1)
  const until = rest.findIndex((line) => /^#{1,6}\s/.test(line))
  const body = until === -1 ? rest : rest.slice(0, until)

  const extracted = [lines[start], ...body].join('\n').trim()
  return extracted.length > 0 ? extracted : undefined
}

/**
 * 文脈に載せてよい文字数。
 *
 * コンテキストは文脈だけのものではない。システム指示・会話履歴・これから書く回答が
 * 同じ席を分け合うので、順に引いてから残りを文字数に直す。割合で雑に引くと、
 * 履歴が伸びた会話で静かに溢れる。
 */
export const contextBudgetChars = (contextSize: number, options: { readonly historyChars?: number } = {}): number => {
  const historyTokens = Math.ceil((options.historyChars ?? 0) / CHARS_PER_TOKEN)
  const available = contextSize - ANSWER_TOKENS - INSTRUCTION_TOKENS - historyTokens

  return available <= 0 ? 0 : Math.floor(available * CHARS_PER_TOKEN)
}

export const filterSegmentsByScope = (
  segments: readonly TranscriptSegment[],
  speakers: readonly Speaker[],
  scope: SpeakerScope
): TranscriptSegment[] => {
  if (scope === 'all') return [...segments]

  const kinds = new Map(speakers.map((speaker) => [speaker.id, speaker.kind]))
  return segments.filter((segment) => {
    // 話者一覧に無い ID でも、`remote:` の名前空間だけで相手だと判断できる。
    const kind = kinds.get(segment.speakerId) ?? (isRemoteSpeakerId(segment.speakerId) ? 'remote' : undefined)
    return scope === 'self' ? kind === 'self' || segment.speakerId === SELF_SPEAKER_ID : kind === 'remote'
  })
}

const pad = (value: number): string => String(value).padStart(2, '0')

const formatDate = (date: Date, language: MeetingLanguage): string => {
  const text = CONTEXT_TEXT[language]
  const isoDate = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return text.date(isoDate, text.weekdays[date.getDay()] ?? '')
}

export const formatContextHeading = (index: number, material: ChatSourceMaterial, language: MeetingLanguage): string =>
  `## [${index}] ${formatDate(material.startedAt, language)} ${material.title}`

const transcriptBody = (material: ChatSourceMaterial, scope: SpeakerScope): { body: string; startMs?: number } => {
  const segments = filterSegmentsByScope(material.segments, material.speakers, scope)
  if (segments.length === 0) return { body: '' }

  const labels = new Map(material.speakers.map((speaker) => [speaker.id, speaker.label]))
  const body = segments
    .map(
      (segment) =>
        `${formatTimestamp(segment.startMs)} ${labels.get(segment.speakerId) ?? segment.speakerId}: ${segment.text.trim()}`
    )
    .join('\n')

  return { body, startMs: segments[0]?.startMs ?? 0 }
}

interface Candidate {
  readonly material: ChatSourceMaterial
  readonly source: 'summary' | 'transcript'
  readonly note: string
  readonly body: string
  readonly startMs?: number
}

/**
 * 何を載せるかを決める。
 *
 * 話者を絞るときは要約では答えられない（要約は誰の発言かを保っていない）ので、
 * 要約があっても文字起こしを使う。逆に、文字起こししか無い録音は要約が
 * 作られる前か失敗した録音なので、そのまま文字起こしを載せる。
 */
const toCandidate = (
  material: ChatSourceMaterial,
  scope: SpeakerScope,
  useTranscript: boolean,
  section: SummarySection | undefined,
  language: MeetingLanguage
): Candidate | undefined => {
  if (useTranscript || scope !== 'all' || !material.summary?.trim()) {
    const { body, startMs } = transcriptBody(material, scope)
    if (body.length > 0) {
      return {
        material,
        source: 'transcript',
        note: CONTEXT_TEXT[language].transcript(scope),
        body,
        ...(startMs === undefined ? {} : { startMs })
      }
    }
    // 話者で絞って何も残らなかった録音は、要約に落として黙って混ぜない。
    if (scope !== 'all') return undefined
  }

  const summary = material.summary?.trim()
  if (!summary) return undefined

  // 節を名指しされていれば、その節だけを渡す。要約の全体を渡すと、4B 級のモデルは
  // 会議ごとの見出しをそのまま写して「会議の一覧」を答えにしてしまう。
  const narrowed = section === undefined ? undefined : extractSummarySection(summary, section)
  return { material, source: 'summary', note: CONTEXT_TEXT[language].summary, body: narrowed ?? summary }
}

/**
 * 予算を録音のあいだで公平に割る。
 *
 * 新しい順に素朴に詰めると、長い 1 件が予算を食い尽くして残りが全部落ちる。
 * まず等分を仮の上限にして測り、上限に届かなかった録音の余りを、
 * 溢れた録音に配り直す。
 */
const allocate = (candidates: readonly Candidate[], budgetChars: number): number[] => {
  const share = Math.floor(budgetChars / candidates.length)
  const surplus = candidates.reduce((total, candidate) => total + Math.max(0, share - candidate.body.length), 0)
  const needy = candidates.filter((candidate) => candidate.body.length > share).length
  const extra = needy === 0 ? 0 : Math.floor(surplus / needy)

  return candidates.map((candidate) => (candidate.body.length > share ? share + extra : candidate.body.length))
}

export const buildChatContext = (params: {
  /** 新しい順で渡す。予算が足りなければ古い方から落とす。 */
  readonly materials: readonly ChatSourceMaterial[]
  readonly scope: SpeakerScope
  readonly useTranscript: boolean
  readonly budgetChars: number
  /** 問いが名指しした要約の節。文字起こしを使うときは効かない。 */
  readonly section?: SummarySection
  /** 問いの言語。見出しと注記をこの言語で書く。 */
  readonly language: MeetingLanguage
}): ChatContext => {
  const text = CONTEXT_TEXT[params.language]
  const all = params.materials
    .map((material) => toCandidate(material, params.scope, params.useTranscript, params.section, params.language))
    .filter((candidate): candidate is Candidate => candidate !== undefined)

  if (all.length === 0) return { text: '', citations: [], droppedCount: 0 }
  // 予算が尽きていれば見出しだけを並べない。中身の無い見出しを渡すと、
  // モデルは「その会議には何も無かった」と読む。
  if (params.budgetChars <= 0) {
    return { text: '', citations: [], droppedCount: params.materials.length }
  }

  const capacity = Math.max(1, Math.floor(params.budgetChars / MIN_PER_RECORDING_CHARS))
  const chosen = all.slice(0, capacity)
  const droppedCount = params.materials.length - chosen.length
  const allowances = allocate(chosen, params.budgetChars)

  const citations: ChatCitation[] = []
  const blocks = chosen.map((candidate, index) => {
    const allowance = allowances[index] ?? candidate.body.length
    const truncated = candidate.body.length > allowance
    const body = truncated ? `${candidate.body.slice(0, allowance)}${text.omission}` : candidate.body

    citations.push({
      recordingId: candidate.material.recordingId,
      title: candidate.material.title,
      startedAt: candidate.material.startedAt,
      source: candidate.source,
      ...(candidate.startMs === undefined ? {} : { startMs: candidate.startMs }),
      truncated
    })

    return `${formatContextHeading(index + 1, candidate.material, params.language)}\n${candidate.note}\n${body}`
  })

  // 落とした件数を書かないと、モデルは与えられた範囲を全体だと思って断定する。
  const notice = droppedCount > 0 ? `\n\n${text.dropped(params.materials.length, chosen.length)}` : ''

  return { text: blocks.join('\n\n') + notice, citations, droppedCount }
}
