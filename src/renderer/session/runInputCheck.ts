import { INPUT_CHECK, judgeInput } from '@domain/InputCheck'
import type { MicCapture } from '../audio/micCapture'
import { messageOf } from '../errorMessage'

export type InputCheckOutcome =
  | { readonly kind: 'heard' }
  | { readonly kind: 'silent' }
  | { readonly kind: 'error'; readonly message: string }

export interface InputCheckResult {
  /** システム音声（相手の声）。確認音が取れたか。 */
  readonly system: InputCheckOutcome
  /** マイク（自分の声）。何か入力があったか。 */
  readonly mic: InputCheckOutcome
}

/** マイクのレベルを読みに行く間隔。短い発話も取りこぼさない程度に細かく。 */
const MIC_POLL_MS = 100

/**
 * テスト録音。マイクとシステム音声を同時に取り、途中でアプリが確認音を鳴らす。
 *
 * 片方が取れなくても、もう片方のテストは続ける —— 両方の状態が分からないと、
 * どちらを直せばよいかを利用者が判断できない。終わったら確認音もマイクも必ず止める。
 */
export const runInputCheck = async (deps: {
  startMic: () => Promise<MicCapture>
  /** main でシステム音声を取り込み、最大の大きさを返す。 */
  probeSystemAudio: (durationMs: number) => Promise<number>
  playTone: () => { stop(): void }
  wait: (ms: number) => Promise<void>
  every: (ms: number, tick: () => void) => () => void
}): Promise<InputCheckResult> => {
  let mic: MicCapture | undefined
  let micError: string | undefined
  try {
    mic = await deps.startMic()
  } catch (error: unknown) {
    micError = messageOf(error)
  }

  let micPeak = 0
  const stopPolling = mic
    ? deps.every(MIC_POLL_MS, () => {
        micPeak = Math.max(micPeak, mic?.level() ?? 0)
      })
    : () => undefined

  // 取り込みを先に動かし、動き出した頃に確認音を鳴らす。
  const probe = deps.probeSystemAudio(INPUT_CHECK.durationMs).then(
    (peak): InputCheckOutcome => ({ kind: judgeInput(peak) }),
    (error: unknown): InputCheckOutcome => ({ kind: 'error', message: messageOf(error) })
  )

  await deps.wait(INPUT_CHECK.toneStartMs)
  const tone = deps.playTone()
  try {
    await deps.wait(INPUT_CHECK.toneDurationMs)
  } finally {
    tone.stop()
  }

  const system = await probe
  stopPolling()
  await mic?.stop()

  return {
    system,
    mic: micError === undefined ? { kind: judgeInput(micPeak) } : { kind: 'error', message: micError }
  }
}
