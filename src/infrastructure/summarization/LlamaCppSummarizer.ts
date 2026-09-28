import type { SummarizationPort } from '@application/ports'
import { AppError } from '@domain/errors'
import type { MemoryProtection } from '@domain/MemoryGuard'
import { NOTES_PLACEHOLDER, TRANSCRIPT_PLACEHOLDER } from '@domain/Settings'

export class SummarizationError extends AppError {}

/**
 * 1 トークンあたりの日本語文字数の概算。
 * 正確なトークナイズはモデルを読み込まないとできないため、分割判断には
 * 安全側（少なめ）に倒した見積もりを使う。
 */
const CHARS_PER_TOKEN = 1.5

/** 出力とプロンプト本体のためにコンテキストから確保しておく割合。 */
const RESERVED_RATIO = 0.4

/**
 * モデルとの 1 回のやり取り。node-llama-cpp を直接使わずこの seam を挟むことで、
 * 分割・統合のロジックをモデル無しで検証できる。
 */
export interface LlmSession {
  prompt(text: string): Promise<string>
  dispose(): Promise<void>
}

export interface LlmSessionFactory {
  create(config: {
    modelPath: string
    contextSize: number
    protection: MemoryProtection
  }): Promise<LlmSession>
}

/**
 * 文字起こしを Markdown ブロック（話者ごとの発話）単位で分割する。
 * 発話の途中で切ると文脈が壊れるため、必ずブロック境界で切る。
 */
export const splitTranscript = (transcript: string, maxChars: number): string[] => {
  if (maxChars <= 0 || transcript.length <= maxChars) return [transcript]

  const blocks = transcript.split('\n\n')
  const chunks: string[] = []
  let current = ''

  for (const block of blocks) {
    if (current.length > 0 && current.length + block.length + 2 > maxChars) {
      chunks.push(current)
      current = block
      continue
    }
    current = current.length === 0 ? block : `${current}\n\n${block}`
  }

  if (current.length > 0) chunks.push(current)
  return chunks
}

/** 組み立て終わったプロンプトへ、利用者が外せない防御の指示を前置きする。 */
const guarded = (prompt: string): string => `${HALLUCINATION_GUARD}\n\n${prompt}`

/**
 * プロンプトの差し込み位置に文字起こしとメモを入れる。位置指定が無い場合は末尾に付ける。
 * メモは空なら差し込み位置ごと消す — 見出しだけ残るとモデルが中身を補おうとする。
 */
export const renderPrompt = (template: string, transcript: string, notes = ''): string => {
  const withTranscript = template.includes(TRANSCRIPT_PLACEHOLDER)
    ? template.split(TRANSCRIPT_PLACEHOLDER).join(transcript)
    : `${template}\n\n${transcript}`

  if (withTranscript.includes(NOTES_PLACEHOLDER)) {
    return withTranscript.split(NOTES_PLACEHOLDER).join(notes)
  }
  return notes ? `${withTranscript}\n\n${notes}` : withTranscript
}

/**
 * 文字起こしに混じるハルシネーションを要約へ持ち込ませないための前置き。
 *
 * 確信度での足切り（WhisperCppTranscriber）をすり抜けた分がここへ届く。whisper は
 * 学習データに字幕を多く含むため、雑音や声の重なった区間で「同じ文の反復」や
 * 動画の締めの決まり文句を出す。会議の内容としては明らかに浮くので、モデルに
 * 判断させるほうが、語句の一覧を増やして本物の発話を巻き込むより安全。
 *
 * 要約プロンプトは設定で編集できる（`Settings.promptTemplate`）。防御の有無が
 * 利用者ごとに変わらないよう、既定値に混ぜずに常に前置きとして付ける。
 */
export const HALLUCINATION_GUARD = [
  '文字起こしは自動生成のため、誤りが混じっています。次のものは会議の内容ではないので、',
  '要約に含めないでください。',
  '- 同じ文や語句が不自然に繰り返されている箇所',
  '- 「ご視聴ありがとうございました」のような動画字幕の定型句',
  '- 前後の話の流れから明らかに浮いている、脈絡のない一文',
  '判断に迷うものは、無理に解釈せずそのまま落としてください。'
].join('\n')

const CHUNK_PROMPT = [
  'これは長い会議の文字起こしの一部です。この範囲で話された内容を、後で全体の',
  '議事録にまとめるための素材として、日本語の箇条書きで漏れなく整理してください。',
  '決定事項・依頼・数値・固有名詞は必ず残してください。',
  '',
  '---',
  TRANSCRIPT_PLACEHOLDER
].join('\n')

/**
 * node-llama-cpp でローカル LLM を動かして議事録を作る。
 *
 * Ollama のような常駐デーモンを必要とせず、GGUF ファイルさえあればアプリ単体で
 * 完結する。文字起こしがコンテキストに収まらない場合は、発話ブロック境界で分割して
 * 部分要約を作り、それらを束ねて最終要約を生成する。
 *
 * 16GB RAM の機体では whisper と同時にモデルを載せられないため、要約が終わったら
 * 必ず dispose してメモリを返す。
 */
export class LlamaCppSummarizer implements SummarizationPort {
  constructor(
    private readonly config: {
      modelPath: string
      contextSize: number
      protection: MemoryProtection
    },
    private readonly factory: LlmSessionFactory
  ) {}

  async summarize(params: {
    transcript: string
    notes?: string
    promptTemplate: string
  }): Promise<string> {
    if (!this.config.modelPath) {
      throw new SummarizationError({ code: 'summaryModelNotConfigured' })
    }
    if (params.transcript.trim().length === 0) {
      throw new SummarizationError({ code: 'summaryTranscriptEmpty' })
    }

    const session = await this.factory.create(this.config)
    try {
      const budget = Math.floor(this.config.contextSize * (1 - RESERVED_RATIO) * CHARS_PER_TOKEN)
      const chunks = splitTranscript(params.transcript, budget)

      const material =
        chunks.length === 1
          ? params.transcript
          : (
              await sequentially(chunks, (chunk) =>
                session.prompt(guarded(renderPrompt(CHUNK_PROMPT, chunk)))
              )
            ).join('\n\n')

      // メモは統合の段でだけ渡す。部分要約にも混ぜると、どの範囲の要約にも同じ論点が現れる。
      return (
        await session.prompt(
          guarded(renderPrompt(params.promptTemplate, material, params.notes ?? ''))
        )
      ).trim()
    } finally {
      // whisper など他の重い処理にメモリを譲るため、使い終わったら必ず解放する。
      await session.dispose()
    }
  }
}

/** チャンク要約は同時実行するとメモリを食い潰すため 1 件ずつ処理する。 */
const sequentially = async <T, R>(
  items: readonly T[],
  run: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = []
  for (const item of items) {
    results.push(await run(item))
  }
  return results
}
