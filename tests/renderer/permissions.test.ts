import { describe, expect, it } from 'vitest'
import { micPermissionView } from '@renderer/permissions'

/**
 * 設定画面の「録音に必要な許可」のうちマイクの行。macOS に問い合わせた状態を、
 * 利用者が次に何をすればよいかの形にする。
 */
describe('micPermissionView', () => {
  it('許可済みなら何もしなくてよい', () => {
    expect(micPermissionView('granted')).toEqual({ label: '許可済み', ok: true, action: undefined })
  })

  it('まだ聞かれていなければ、その場で許可を求められる', () => {
    expect(micPermissionView('not-determined')).toEqual({
      label: 'まだ許可していません',
      ok: false,
      action: 'request'
    })
  })

  it('拒否されていたらシステム設定へ案内する（macOS は二度目のダイアログを出さない）', () => {
    expect(micPermissionView('denied')).toEqual({
      label: '許可されていません',
      ok: false,
      action: 'open-settings'
    })
  })

  it('管理者に制限されているときも、行き先はシステム設定', () => {
    expect(micPermissionView('restricted').action).toBe('open-settings')
  })

  it('状態が分からなければそう書き、システム設定へ案内する', () => {
    expect(micPermissionView('unknown')).toEqual({
      label: '確認できません',
      ok: false,
      action: 'open-settings'
    })
  })
})
