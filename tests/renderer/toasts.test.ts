import { describe, expect, it } from 'vitest'
import {
  TOAST_LIMIT,
  dismissToast,
  expireToasts,
  nextExpiry,
  pauseToast,
  persistentToastKinds,
  pushToast,
  resumeToast,
  toastDurationMs,
  type TransientToast
} from '@renderer/toasts'

const push = (queue: readonly TransientToast[], text: string, nowMs = 0, id = queue.length + 1) =>
  pushToast(queue, { tone: 'error', text }, nowMs, id)

describe('自動で消えるトースト', () => {
  it('種類ごとの時間が経つと期限が来る', () => {
    const queue = pushToast([], { tone: 'info', text: 'お知らせ' }, 1_000, 1)

    expect(queue).toEqual([{ id: 1, tone: 'info', text: 'お知らせ', expiresAtMs: 1_000 + toastDurationMs('info') }])
    expect(expireToasts(queue, 1_000 + toastDurationMs('info') - 1)).toHaveLength(1)
    expect(expireToasts(queue, 1_000 + toastDurationMs('info'))).toEqual([])
  })

  it('エラーはお知らせより長く出す', () => {
    expect(toastDurationMs('error')).toBeGreaterThan(toastDurationMs('info'))
  })

  it('上限を超えたら古いものから落とす', () => {
    let queue: readonly TransientToast[] = []
    for (let i = 1; i <= TOAST_LIMIT + 1; i += 1) queue = push(queue, `失敗 ${i}`, i, i)

    expect(queue.map((toast) => toast.text)).toEqual(['失敗 2', '失敗 3', '失敗 4'])
  })

  it('同じ文言が続いたら積まずに期限を延ばす', () => {
    const first = push([], '保存できません', 0, 1)
    const again = push(first, '保存できません', 3_000, 2)

    expect(again).toEqual([
      { id: 1, tone: 'error', text: '保存できません', expiresAtMs: 3_000 + toastDurationMs('error') }
    ])
  })

  it('閉じたものだけを除く', () => {
    const queue = push(push([], 'A', 0, 1), 'B', 0, 2)

    expect(dismissToast(queue, 1).map((toast) => toast.text)).toEqual(['B'])
  })

  it('止めている間は期限が来ず、再開すると残りの時間から数える', () => {
    const queue = push([], 'A', 0, 1)
    const paused = pauseToast(queue, 1, 2_000)

    expect(expireToasts(paused, 100_000)).toHaveLength(1)
    expect(nextExpiry(paused)).toBeUndefined()

    const resumed = resumeToast(paused, 1, 50_000)
    expect(nextExpiry(resumed)).toBe(50_000 + toastDurationMs('error') - 2_000)
  })

  it('次に消える時刻は最も早い期限', () => {
    const queue = pushToast(push([], 'A', 0, 1), { tone: 'info', text: 'B' }, 0, 2)

    expect(nextExpiry(queue)).toBe(toastDurationMs('info'))
    expect(nextExpiry([])).toBeUndefined()
  })
})

describe('応答を待つトースト', () => {
  const silenceAlert = { recordingId: 'r1', silentDurationMs: 600_000 }
  const autoStarted = { recordingId: 'r1', eventTitle: '定例' }
  const startAlert = { micBusyDurationMs: 60_000 }

  it('録音中は自動開始と無音の確認を、古い順に上から出す', () => {
    expect(persistentToastKinds({ active: true, recordingId: 'r1', silenceAlert, autoStarted, startAlert })).toEqual([
      'auto-started',
      'silence'
    ])
  })

  it('自動開始の知らせは、その録音の間だけ出す', () => {
    expect(persistentToastKinds({ active: true, recordingId: 'r2', autoStarted })).toEqual([])
  })

  it('録音していないときは開始忘れの確認だけを出す', () => {
    expect(persistentToastKinds({ active: false, silenceAlert, autoStarted, startAlert })).toEqual(['start-alert'])
    expect(persistentToastKinds({ active: false })).toEqual([])
  })
})
