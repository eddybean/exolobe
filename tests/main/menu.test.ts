import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ Menu: {}, app: {}, shell: {} }))

const { leadingMenuRole } = await import('../../src/main/menu')

describe('leadingMenuRole', () => {
  it('macOS は先頭にアプリ名のメニュー（appMenu）を置く', () => {
    expect(leadingMenuRole('macos')).toBe('appMenu')
  })

  it('Windows は appMenu が無いので、終了を含むファイルメニューを置く', () => {
    expect(leadingMenuRole('windows')).toBe('fileMenu')
  })
})
