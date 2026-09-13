import type { SpeakerScope } from '@domain/ChatQuery'
import { isRemoteSpeakerId, SELF_SPEAKER_ID, type Speaker } from '@domain/Speaker'
import { formatTimestamp } from '@domain/Transcript'
import type { TranscriptSegment } from '@domain/TranscriptSegment'

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
 * 1 トークンあたりの日本語文字数の概算。
 *
 * LlamaCppSummarizer の同名定数と値は同じだが、あちらを動かすと既存の要約の
 * 分割挙動が変わるため共有しない。正確なトークナイズはモデルを読まないとできず、
 * 安全側（少なめ）に見積もる方針も同じ。
 */
export const CHARS_PER_TOKEN = 1.5

/** 出力と指示文のためにコンテキストから空けておく割合。 */
export const CHAT_RESERVED_RATIO = 0.35

/**
 * 1 録音に最低これだけは割く。下回るなら載せない。
 *
 * 数百字に満たない断片は、要約としても引用としても役に立たないうえ、
 * 「その会議には何も無かった」とモデルに誤読させる。
 */
export const MIN_PER_RECORDING_CHARS = 400

const OMISSION = '…（以下省略）'

export const contextBudgetChars = (
  contextSize: number,
  reservedRatio: number = CHAT_RESERVED_RATIO
): number => Math.floor(contextSize * (1 - reservedRatio) * CHARS_PER_TOKEN)

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
    return scope === 'self'
      ? kind === 'self' || segment.speakerId === SELF_SPEAKER_ID
      : kind === 'remote'
  })
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

const pad = (value: number): string => String(value).padStart(2, '0')

const formatDate = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}（${WEEKDAYS[date.getDay()] ?? ''}）`

export const formatContextHeading = (index: number, material: ChatSourceMaterial): string =>
  `## [${index}] ${formatDate(material.startedAt)} ${material.title}`

const scopeNote = (scope: SpeakerScope): string =>
  scope === 'self' ? '自分の発言のみ・文字起こし' : scope === 'remote' ? '相手の発言のみ・文字起こし' : '文字起こし'

const transcriptBody = (
  material: ChatSourceMaterial,
  scope: SpeakerScope
): { body: string; startMs?: number } => {
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
  useTranscript: boolean
): Candidate | undefined => {
  if (useTranscript || scope !== 'all' || !material.summary?.trim()) {
    const { body, startMs } = transcriptBody(material, scope)
    if (body.length > 0) {
      return {
        material,
        source: 'transcript',
        note: `（${scopeNote(scope)}）`,
        body,
        ...(startMs === undefined ? {} : { startMs })
      }
    }
    // 話者で絞って何も残らなかった録音は、要約に落として黙って混ぜない。
    if (scope !== 'all') return undefined
  }

  const summary = material.summary?.trim()
  if (!summary) return undefined
  return { material, source: 'summary', note: '（要約）', body: summary }
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
  const surplus = candidates.reduce(
    (total, candidate) => total + Math.max(0, share - candidate.body.length),
    0
  )
  const needy = candidates.filter((candidate) => candidate.body.length > share).length
  const extra = needy === 0 ? 0 : Math.floor(surplus / needy)

  return candidates.map((candidate) =>
    candidate.body.length > share ? share + extra : candidate.body.length
  )
}

export const buildChatContext = (params: {
  /** 新しい順で渡す。予算が足りなければ古い方から落とす。 */
  readonly materials: readonly ChatSourceMaterial[]
  readonly scope: SpeakerScope
  readonly useTranscript: boolean
  readonly budgetChars: number
}): ChatContext => {
  const all = params.materials
    .map((material) => toCandidate(material, params.scope, params.useTranscript))
    .filter((candidate): candidate is Candidate => candidate !== undefined)

  if (all.length === 0) return { text: '', citations: [], droppedCount: 0 }

  const capacity = Math.max(1, Math.floor(params.budgetChars / MIN_PER_RECORDING_CHARS))
  const chosen = all.slice(0, capacity)
  const droppedCount = params.materials.length - chosen.length
  const allowances = allocate(chosen, params.budgetChars)

  const citations: ChatCitation[] = []
  const blocks = chosen.map((candidate, index) => {
    const allowance = allowances[index] ?? candidate.body.length
    const truncated = candidate.body.length > allowance
    const body = truncated ? `${candidate.body.slice(0, allowance)}${OMISSION}` : candidate.body

    citations.push({
      recordingId: candidate.material.recordingId,
      title: candidate.material.title,
      startedAt: candidate.material.startedAt,
      source: candidate.source,
      ...(candidate.startMs === undefined ? {} : { startMs: candidate.startMs }),
      truncated
    })

    return `${formatContextHeading(index + 1, candidate.material)}\n${candidate.note}\n${body}`
  })

  // 落とした件数を書かないと、モデルは与えられた範囲を全体だと思って断定する。
  const notice =
    droppedCount > 0
      ? `\n\n※ 対象は ${params.materials.length} 件ありましたが、長さの都合で新しい ${chosen.length} 件だけを載せています。`
      : ''

  return { text: blocks.join('\n\n') + notice, citations, droppedCount }
}
