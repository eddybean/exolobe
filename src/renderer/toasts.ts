import type { AutoStartedDto, SilenceAlertDto, StartAlertDto } from '@shared/ipc'

/**
 * 画面右下に積むトーストの規則。
 *
 * フッターに直接並べると、長い文で高さが伸び、重なると横に押し合って崩れた。
 * 操作を求めるもの（応答するまで残す）と、知らせるだけのもの（時間で消す）を分け、
 * どちらを・どの順で出すかをここで決めて、描画は並べるだけにする。
 */

export type ToastTone = 'error' | 'info'

export interface TransientToast {
  readonly id: number
  readonly tone: ToastTone
  readonly text: string
  readonly expiresAtMs: number
  /** ホバー中など止めている間の残り時間。止めていなければ無い。 */
  readonly pausedRemainingMs?: number
}

/** 積みすぎると画面を覆うので、知らせるだけのものは数を限る。 */
export const TOAST_LIMIT = 3

/** エラーは読み取ってから対処を考えるので、お知らせより長く残す。 */
export const toastDurationMs = (tone: ToastTone): number => (tone === 'error' ? 8_000 : 5_000)

export const pushToast = (
  queue: readonly TransientToast[],
  toast: { readonly tone: ToastTone; readonly text: string },
  nowMs: number,
  id: number
): readonly TransientToast[] => {
  const expiresAtMs = nowMs + toastDurationMs(toast.tone)
  // 同じ失敗を繰り返したときに同じ文で画面を埋めない。出ているものを延ばす。
  const same = queue.find((existing) => existing.tone === toast.tone && existing.text === toast.text)
  if (same) {
    return queue.map((existing) =>
      existing === same ? { id: existing.id, tone: existing.tone, text: existing.text, expiresAtMs } : existing
    )
  }
  return [...queue, { id, tone: toast.tone, text: toast.text, expiresAtMs }].slice(-TOAST_LIMIT)
}

export const expireToasts = (queue: readonly TransientToast[], nowMs: number): readonly TransientToast[] =>
  queue.filter((toast) => toast.pausedRemainingMs !== undefined || toast.expiresAtMs > nowMs)

export const dismissToast = (queue: readonly TransientToast[], id: number): readonly TransientToast[] =>
  queue.filter((toast) => toast.id !== id)

/** 読んでいる途中で消えないよう、ホバーしている間は時間を止める。 */
export const pauseToast = (queue: readonly TransientToast[], id: number, nowMs: number): readonly TransientToast[] =>
  queue.map((toast) =>
    toast.id === id && toast.pausedRemainingMs === undefined
      ? { ...toast, pausedRemainingMs: Math.max(0, toast.expiresAtMs - nowMs) }
      : toast
  )

export const resumeToast = (queue: readonly TransientToast[], id: number, nowMs: number): readonly TransientToast[] =>
  queue.map((toast) =>
    toast.id === id && toast.pausedRemainingMs !== undefined
      ? { id: toast.id, tone: toast.tone, text: toast.text, expiresAtMs: nowMs + toast.pausedRemainingMs }
      : toast
  )

/** 次に消える時刻。止めているものは数えない（タイマーを 1 本だけ張るため）。 */
export const nextExpiry = (queue: readonly TransientToast[]): number | undefined => {
  const times = queue.filter((toast) => toast.pausedRemainingMs === undefined).map((toast) => toast.expiresAtMs)
  return times.length === 0 ? undefined : Math.min(...times)
}

export type PersistentToastKind = 'auto-started' | 'silence' | 'start-alert'

export interface PersistentToastSource {
  readonly active: boolean
  readonly recordingId?: string
  readonly silenceAlert?: SilenceAlertDto | undefined
  readonly startAlert?: StartAlertDto | undefined
  readonly autoStarted?: AutoStartedDto | undefined
}

/**
 * 応答を待つトーストを、上から出す順に返す。
 * 自動開始の知らせは録音の始まりに、無音の確認はその後に来るので、古い順に並べる。
 */
export const persistentToastKinds = (source: PersistentToastSource): readonly PersistentToastKind[] => {
  if (!source.active) return source.startAlert ? ['start-alert'] : []

  const kinds: PersistentToastKind[] = []
  // 別の録音で自動開始した知らせを、今の録音の取り消し口として出さない。
  if (source.autoStarted && source.autoStarted.recordingId === source.recordingId) kinds.push('auto-started')
  if (source.silenceAlert) kinds.push('silence')
  return kinds
}
