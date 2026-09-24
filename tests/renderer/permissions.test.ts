import { describe, expect, it } from 'vitest'
import { inputCheckView, micPermissionView } from '@renderer/permissions'

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

/** テスト録音の結果を、何が分かって次に何をすればよいかの形にする。 */
describe('inputCheckView', () => {
  it('両方入れば、そのまま録音できると伝える', () => {
    const view = inputCheckView({ system: { kind: 'heard' }, mic: { kind: 'heard' } })

    expect(view.map((row) => [row.subject, row.ok])).toEqual([
      ['相手の声（システム音声）', true],
      ['自分の声（マイク）', true]
    ])
  })

  it('確認音が取れなければ許可が無いとみなし、システム設定へ案内する', () => {
    const [system] = inputCheckView({ system: { kind: 'silent' }, mic: { kind: 'heard' } })

    expect(system?.ok).toBe(false)
    expect(system?.openSettings).toBe('system-audio')
    // 初めてのテストでは、許可のダイアログに答える前の取り込みは無音のまま終わる。
    expect(system?.message).toContain('もう一度')
  })

  it('マイクに何も入らなければ、話しながら試すよう促す（許可の問題とは限らない）', () => {
    const [, mic] = inputCheckView({ system: { kind: 'heard' }, mic: { kind: 'silent' } })

    expect(mic?.ok).toBe(false)
    expect(mic?.openSettings).toBeUndefined()
    expect(mic?.message).toContain('話し')
  })

  it('取れなかった理由があれば、それをそのまま見せる', () => {
    const [system] = inputCheckView({
      system: { kind: 'error', message: '録音中はテストできません。' },
      mic: { kind: 'heard' }
    })

    expect(system?.message).toBe('録音中はテストできません。')
  })
})
