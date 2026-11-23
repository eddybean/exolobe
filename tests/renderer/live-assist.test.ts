import { describe, expect, it } from 'vitest'
import { defaultSettings, mergeSettings } from '@domain/Settings'
import { appendNoteLines, assistLayout, isPinnedToBottom, liveAssistSetting } from '@renderer/library/liveAssist'

describe('appendNoteLines', () => {
  it('メモの末尾に行を足し、足した行に今の時刻を付ける', () => {
    const lines = appendNoteLines([{ text: '- 決まったこと', atMs: 1_000 }], ['ToDo: 営業に連絡する'], 90_000)

    expect(lines).toEqual([
      { text: '- 決まったこと', atMs: 1_000 },
      { text: 'ToDo: 営業に連絡する', atMs: 90_000 }
    ])
  })

  it('空のメモにも足せる。末尾の空行は詰めて使う', () => {
    expect(appendNoteLines([], ['決定: 22日'], 5_000)).toEqual([{ text: '決定: 22日', atMs: 5_000 }])
    expect(appendNoteLines([{ text: 'a', atMs: 0 }, { text: '' }], ['b'], 5_000)).toEqual([
      { text: 'a', atMs: 0 },
      { text: 'b', atMs: 5_000 }
    ])
  })
})

describe('isPinnedToBottom', () => {
  it('最下部付近なら追いかけ、上へ読み戻していたら止める', () => {
    expect(isPinnedToBottom({ scrollTop: 192, clientHeight: 200, scrollHeight: 400 })).toBe(true)
    expect(isPinnedToBottom({ scrollTop: 100, clientHeight: 200, scrollHeight: 400 })).toBe(false)
  })
})

describe('assistLayout', () => {
  const enabled = mergeSettings(defaultSettings('ja'), { liveAssist: { enabled: true } }).liveAssist

  it('無効なら何も出さない', () => {
    expect(assistLayout(defaultSettings('ja').liveAssist, 'available').panel).toBe(false)
  })

  it('Apple Intelligence が使えれば見出しとボタンを出す', () => {
    expect(assistLayout(enabled, 'available')).toEqual({ panel: true, captions: true, headlines: true, actions: true })
  })

  it('Apple Intelligence が使えなければ見出しとボタンを隠す（分かるまでは隠しておく）', () => {
    expect(assistLayout(enabled, 'apple-intelligence-not-enabled')).toEqual({
      panel: true,
      captions: true,
      headlines: false,
      actions: false
    })
    expect(assistLayout(enabled, undefined).actions).toBe(false)
  })

  it('利用者が切った見出しと字幕は出さない', () => {
    expect(assistLayout({ ...enabled, headlines: false, captions: false }, 'available')).toEqual({
      panel: true,
      captions: false,
      headlines: false,
      actions: true
    })
  })
})

describe('liveAssistSetting', () => {
  it('macOS 26 未満・Windows（認識器が無い）では選ばせず、理由を返す', () => {
    expect(liveAssistSetting('available')).toEqual({ selectable: true })
    expect(liveAssistSetting('unsupported-os')).toEqual({ selectable: false, reason: 'unsupported-os' })
    expect(liveAssistSetting('missing')).toEqual({ selectable: false, reason: 'missing' })
    expect(liveAssistSetting(undefined)).toEqual({ selectable: false })
  })
})
