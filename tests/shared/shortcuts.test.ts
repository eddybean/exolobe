import { describe, expect, it } from 'vitest'
import { recordingShortcut } from '@shared/shortcuts'

describe('recordingShortcut', () => {
  it('macOS は ⌃⌥⌘R', () => {
    expect(recordingShortcut('macos')).toEqual({ accelerator: 'Control+Alt+Command+R', label: '⌃⌥⌘R' })
  })

  it('Windows は Windows キーを使わず Ctrl+Alt+Shift+R', () => {
    expect(recordingShortcut('windows')).toEqual({ accelerator: 'Control+Alt+Shift+R', label: 'Ctrl+Alt+Shift+R' })
  })
})
