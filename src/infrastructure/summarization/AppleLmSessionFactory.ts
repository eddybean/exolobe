import { spawn } from 'node:child_process'
import type { AppleIntelligenceStatus } from '@domain/AppleIntelligence'
import { SummarizationError, type LlmSession, type LlmSessionFactory } from './LlamaCppSummarizer'
import { RESPOND_EXIT, isReportedAvailability, parseAppleLmStatus } from './appleLmProtocol'

/** status は OS に可否を聞くだけ。固まっても設定画面を待たせない。 */
const STATUS_TIMEOUT_MS = 10_000

/**
 * 1 回の応答を打ち切るまでの時間。実測では 1 回あたり十数秒〜数十秒で、
 * 打ち切るのはモデルが固まったときだけにしたい。
 */
const RESPOND_TIMEOUT_MS = 10 * 60_000

interface Completed {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

const run = (binaryPath: string, args: readonly string[], stdin: string, timeoutMs: number): Promise<Completed> =>
  new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { timeout: timeoutMs })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    // 応答を待たずに終わった（使えない等）とき、書き込みの EPIPE で落ちないようにする。
    child.stdin.on('error', () => {})
    child.stdin.end(stdin)
  })

/**
 * Apple Intelligence が要約に使えるかを applelm に聞く（ADR-046）。
 * 失敗はすべて「使えない」に倒す。設定画面で選べなくなるだけで済む。
 */
export const appleIntelligenceStatus = async (binaryPath: string | undefined): Promise<AppleIntelligenceStatus> => {
  if (binaryPath === undefined) return { availability: 'missing' }
  try {
    const { code, stdout } = await run(binaryPath, ['status'], '', STATUS_TIMEOUT_MS)
    return code === 0 ? parseAppleLmStatus(stdout) : { availability: 'unavailable' }
  } catch {
    return { availability: 'unavailable' }
  }
}

/**
 * Apple Intelligence で 1 回ずつ応答するセッション（ADR-046）。
 *
 * 分割・統合・防御の前置きは LlamaCppSummarizer がそのまま担い、ここは応答の入れ物だけを
 * 差し替える。モデルは OS のプロセスで動くので、読み込みも解放も無い。コンテキストが 8192 トークンしか
 * ないため、applelm は呼ぶたびに新しいセッションを作り、前の応答を持ち越さない。
 */
export class AppleLmSessionFactory implements LlmSessionFactory {
  constructor(private readonly binaryPath: string | undefined) {}

  async create(): Promise<LlmSession> {
    const binaryPath = this.binaryPath
    if (binaryPath === undefined) {
      throw new SummarizationError({
        code: 'appleIntelligenceUnavailable',
        availability: 'missing'
      })
    }
    return {
      prompt: (text) => respond(binaryPath, text),
      dispose: async () => {}
    }
  }
}

const respond = async (binaryPath: string, prompt: string): Promise<string> => {
  let completed: Completed
  try {
    completed = await run(binaryPath, ['respond'], prompt, RESPOND_TIMEOUT_MS)
  } catch (error: unknown) {
    throw new SummarizationError({ code: 'appleIntelligenceFailed', detail: String(error) }, { cause: error })
  }

  const { code, stdout, stderr } = completed
  if (code === 0) return stdout

  const detail = stderr.trim()
  switch (code) {
    case RESPOND_EXIT.unavailable: {
      const reported = detail.split('\n')[0]
      throw new SummarizationError({
        code: 'appleIntelligenceUnavailable',
        availability: isReportedAvailability(reported) && reported !== 'available' ? reported : 'unavailable'
      })
    }
    case RESPOND_EXIT.rejected:
      throw new SummarizationError({ code: 'appleIntelligenceRejected' })
    case RESPOND_EXIT.unsupportedLanguage:
      throw new SummarizationError({ code: 'appleIntelligenceUnsupportedLanguage' })
    default:
      // 打ち切り（code が null）もここに来る。
      throw new SummarizationError({
        code: 'appleIntelligenceFailed',
        detail: detail || `exit ${String(code)}`
      })
  }
}
