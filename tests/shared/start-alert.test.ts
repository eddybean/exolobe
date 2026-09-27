import { describe, expect, it } from 'vitest'
import { autoStartedMessage, startAlertMessage } from '@shared/startAlert'

/** 開始忘れの確認バーと OS 通知の文面。予定の有無で言い方を変える（ADR-041）。 */
describe('startAlertMessage', () => {
  it('予定が無ければ、マイクが使われている時間で知らせる', () => {
    expect(startAlertMessage({ micBusyDurationMs: 180_000 })).toBe(
      '3 分以上、他のアプリがマイクを使っています。'
    )
  })

  it('分に割り切れない時間を丸めない（既定の 1 分半が「2 分」と出ていた）', () => {
    expect(startAlertMessage({ micBusyDurationMs: 90_000 })).toBe(
      '1.5 分以上、他のアプリがマイクを使っています。'
    )
  })

  it('1 分に満たなければ秒で言う', () => {
    expect(startAlertMessage({ micBusyDurationMs: 30_000 })).toBe(
      '30 秒以上、他のアプリがマイクを使っています。'
    )
  })

  it('会議の予定があれば、時間ではなく予定の名前で言う', () => {
    expect(startAlertMessage({ micBusyDurationMs: 30_000, eventTitle: '週次定例' })).toBe(
      '「週次定例」の時間に、他のアプリがマイクを使っています。'
    )
  })
})

describe('autoStartedMessage', () => {
  it('何をきっかけに始めたかと、取り消し方を伝える', () => {
    expect(autoStartedMessage('週次定例')).toBe(
      '「週次定例」の時間にマイクが使われていたため、自動で録音を始めました。録ってはいけない会議なら「停止して破棄」を押してください。'
    )
  })
})
