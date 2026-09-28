import { describe, expect, it } from 'vitest'
import type { UpdateStatusDto } from '@shared/ipc'
import { updateGuidance } from '../../src/renderer/update'

const status = (patch: Partial<UpdateStatusDto>): UpdateStatusDto => ({
  currentVersion: '0.2.2',
  checkedAt: '2026-09-28T03:00:00.000Z',
  available: null,
  ...patch
})

/**
 * 入れ方で案内を分ける（ADR-044）。Homebrew で入れた人が DMG で上書きすると、
 * brew の記録と実体の版が食い違う。
 */
describe('updateGuidance', () => {
  it('Homebrew で入れた人には brew の更新コマンドを案内する', () => {
    expect(
      updateGuidance(status({ available: { version: '0.3.0', installSource: 'homebrew' } }))
    ).toEqual({ kind: 'homebrew', version: '0.3.0', command: 'brew upgrade --cask exolobe' })
  })

  it('DMG で入れた人には配布ページを案内する', () => {
    expect(
      updateGuidance(status({ available: { version: '0.3.0', installSource: 'dmg' } }))
    ).toEqual({ kind: 'download', version: '0.3.0' })
  })

  it('新しい版が無ければ、確かめた時刻とともに最新だと伝える', () => {
    expect(updateGuidance(status({}))).toEqual({
      kind: 'upToDate',
      checkedAt: '2026-09-28T03:00:00.000Z'
    })
  })

  it('まだ一度も確かめていなければ、そう伝える（最新とは言わない）', () => {
    expect(updateGuidance(status({ checkedAt: null }))).toEqual({ kind: 'unchecked' })
  })

  it('自動で確かめない設定なら、最新かどうかは言わない（覚えていた版を隠しているだけ）', () => {
    expect(updateGuidance(status({}), { automatic: false })).toEqual({ kind: 'manualOnly' })
  })

  it('確認しない設定でも、自分で確かめた後はその結果を伝える', () => {
    expect(updateGuidance(status({}), { automatic: true })).toMatchObject({ kind: 'upToDate' })
    expect(
      updateGuidance(status({ available: { version: '0.3.0', installSource: 'dmg' } }), {
        automatic: false
      })
    ).toEqual({ kind: 'download', version: '0.3.0' })
  })
})
