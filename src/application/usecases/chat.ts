import type {
  ChatCompletionPort,
  ChatTurn,
  ClockPort,
  RecordingArtifactPort,
  RecordingFinderPort,
  RecordingRepositoryPort,
  SettingsRepositoryPort,
  SystemResourcePort
} from '@application/ports'
import { isSettled } from '@application/usecases/search'
import {
  buildChatContext,
  contextBudgetChars,
  type ChatCitation,
  type ChatSourceMaterial
} from '@domain/ChatContext'
import { chatPrompts, renderChatPrompt } from '@domain/ChatPrompt'
import { hasTopic, planChatQuery, type ChatQueryPlan } from '@domain/ChatQuery'
import { AppError, ConfigurationError } from '@domain/errors'
import { estimateSummarizationBytes, insufficientMemory } from '@domain/MemoryGuard'
import { questionLanguageOf } from '@domain/MeetingLanguage'
import type { Recording } from '@domain/Recording'

/**
 * ライブラリ全体に自然文で問いかける。
 *
 * どの録音を見るかは domain の純粋関数が決め、モデルは渡された文脈を読んで
 * 答えるだけにする。絞り込みをモデルに任せると、外したことが出力から見えない。
 */

export interface ChatAnswer {
  readonly text: string
  readonly citations: readonly ChatCitation[]
  /**
   * 何を見て答えたか（「先週（08/31〜09/06）」の 2 件）。期間は問いの言い回しをそのまま使い、
   * 件数と組み合わせた文言は画面が UI の言語で作る（ADR-043）。
   */
  readonly scope?: { readonly rangeLabel: string; readonly count: number }
  readonly usedTranscript: boolean
  readonly droppedCount: number
  /** 生成の上限に達して書ききれなかったか。 */
  readonly truncated: boolean
}

export interface AskChatDeps {
  readonly repository: RecordingRepositoryPort
  readonly artifacts: RecordingArtifactPort
  readonly settings: SettingsRepositoryPort
  readonly system: SystemResourcePort
  readonly clock: ClockPort
  readonly chat: ChatCompletionPort
  /** 意味検索が使えない構成では省く。期間だけで絞って続ける。 */
  readonly finder?: RecordingFinderPort
}

/** finder に投げる件数。上限より多めに取り、期間との積で減っても足りるようにする。 */
const FINDER_MULTIPLIER = 3

const inRange = (recording: Recording, plan: ChatQueryPlan): boolean =>
  plan.range === undefined ||
  (recording.startedAt.getTime() >= plan.range.fromMs &&
    recording.startedAt.getTime() < plan.range.toMs)

/**
 * 数 GB のモデルを読み込む前に空きを確認する。
 *
 * 要約と同じモデル・同じコンテキスト長で動かすので、見積もりの係数もそのまま使える。
 * 会議中に問いかけられることがあり、そこで黙ってモデルを載せると OS ごと重くなる。
 */
const ensureChatMemory = async (deps: AskChatDeps, modelPath: string): Promise<void> => {
  const settings = await deps.settings.load()
  if (settings.memoryProtection === 'off') return

  const modelFileBytes = await deps.system.fileSize(modelPath)
  if (modelFileBytes === undefined) return

  const shortage = insufficientMemory({
    snapshot: await deps.system.memory(),
    demand: {
      bytes: estimateSummarizationBytes({
        modelFileBytes,
        contextSize: settings.summarization.contextSize
      }),
      task: 'chat'
    },
    protection: settings.memoryProtection
  })
  if (shortage) throw new AppError(shortage)
}

/**
 * 話題語で候補を絞る。
 *
 * 期間で絞った結果が空なら呼ばない — 利用者が指定した期間の外を勝手に見に行かない。
 * 意味検索が使えない構成でも呼ばない。使えないときの「該当なし」は検索結果ではなく
 * 単に確かめられなかっただけで、それで候補を落とすと期間で答えられる問いまで
 * 「記録がありません」になる。失敗したときに期間だけで答えるのも同じ理由。
 */
const narrowByTopic = async (
  deps: AskChatDeps,
  plan: ChatQueryPlan,
  candidates: readonly Recording[],
  limit: number,
  searchAvailable: boolean
): Promise<readonly Recording[]> => {
  if (!deps.finder || !searchAvailable || !hasTopic(plan) || candidates.length === 0) {
    return candidates
  }

  let ids: readonly string[]
  try {
    ids = await deps.finder.find({ topic: plan.topic, limit: limit * FINDER_MULTIPLIER })
  } catch {
    return candidates
  }

  const byId = new Map(candidates.map((recording) => [recording.id, recording]))
  // 順序は検索のスコア順を尊重する。期間で絞った集合との積を取る。
  return ids
    .map((id) => byId.get(id))
    .filter((recording): recording is Recording => recording !== undefined)
}

const loadMaterial = async (
  artifacts: RecordingArtifactPort,
  recording: Recording,
  needsTranscript: boolean
): Promise<ChatSourceMaterial> => {
  // 文字起こしは要らないなら読まない。5GB のモデルを載せる前に無駄な I/O をしない。
  const transcript = needsTranscript ? await artifacts.readTranscript(recording) : undefined
  const summary = await artifacts.readSummary(recording)

  return {
    recordingId: recording.id,
    title: recording.title,
    startedAt: recording.startedAt,
    ...(summary === undefined ? {} : { summary }),
    segments: transcript?.segments ?? [],
    speakers: transcript?.speakers ?? []
  }
}

export class AskChat {
  constructor(private readonly deps: AskChatDeps) {}

  async execute(params: {
    question: string
    history: readonly ChatTurn[]
    onChunk: (text: string) => void
    signal?: AbortSignal
  }): Promise<ChatAnswer> {
    const settings = await this.deps.settings.load()
    if (!settings.summarization.modelPath) {
      throw new ConfigurationError({ code: 'chatModelNotConfigured' })
    }

    const plan = planChatQuery(params.question, this.deps.clock.now())
    const limit = settings.chat.maxRecordings

    const settledInRange = (await this.deps.repository.list())
      .filter((recording) => isSettled(recording) && inRange(recording, plan))
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())

    const narrowed = await narrowByTopic(
      this.deps,
      plan,
      settledInRange,
      limit,
      settings.search.enabled && settings.search.modelPath !== ''
    )
    const chosen = narrowed.slice(0, limit)

    // 文脈が空でもモデルには尋ねる。「記録が無い」と答えるのも回答のうちで、
    // ここで例外にすると会話が途切れて言い直しにくい。
    const materials = await Promise.all(
      chosen.map((recording) => loadMaterial(this.deps.artifacts, recording, plan.needsTranscript))
    )

    // チャットは録音をまたぐので、会議の言語ではなく問いの言語で答えさせる（ADR-043）。
    const language = questionLanguageOf(params.question)
    const prompts = chatPrompts(language)
    const context = buildChatContext({
      language,
      materials,
      scope: plan.speakerScope,
      useTranscript: plan.needsTranscript,
      // 会話履歴も同じコンテキストに載る。伸びたぶんだけ文脈の席は減る。
      budgetChars: contextBudgetChars(settings.summarization.contextSize, {
        historyChars: params.history.reduce((total, turn) => total + turn.text.length, 0)
      }),
      ...(plan.section === undefined ? {} : { section: plan.section })
    })

    await ensureChatMemory(this.deps, settings.summarization.modelPath)

    const completion = await this.deps.chat.complete({
      system: prompts.system,
      history: params.history,
      prompt: renderChatPrompt(prompts.prompt, language, {
        context: context.text,
        question: params.question
      }),
      onChunk: params.onChunk,
      ...(params.signal === undefined ? {} : { signal: params.signal })
    })

    const dropped = narrowed.length - chosen.length + context.droppedCount

    return {
      text: completion.text,
      citations: context.citations,
      ...(plan.rangeLabel === undefined
        ? {}
        : { scope: { rangeLabel: plan.rangeLabel, count: context.citations.length } }),
      usedTranscript: context.citations.some((citation) => citation.source === 'transcript'),
      droppedCount: dropped,
      truncated: completion.truncated
    }
  }
}
