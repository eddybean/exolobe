import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ Menu: {}, app: {}, shell: {} }))

const { applicationMenuTemplate, leadingMenuRole } = await import('../../src/main/menu')
const { setAppLocale, text } = await import('../../src/main/i18n')

describe('leadingMenuRole', () => {
  it('macOS は先頭にアプリ名のメニュー（appMenu）を置く', () => {
    expect(leadingMenuRole('macos')).toBe('appMenu')
  })

  it('Windows は appMenu が無いので、終了を含むファイルメニューを置く', () => {
    expect(leadingMenuRole('windows')).toBe('fileMenu')
  })
})

const noop = (): void => {}
const actions = { start: noop, stop: noop, showWindow: noop, openDocs: noop }

/** 区切り線以外のすべての項目（入れ子を含む）。 */
const items = (template: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  template.flatMap((item) => [
    ...(item.type === 'separator' ? [] : [item]),
    ...(Array.isArray(item.submenu) ? items(item.submenu) : [])
  ])

describe('applicationMenuTemplate', () => {
  it('Windows では、役割の項目にも UI の言語の名前を付ける（Electron の既定は英語のまま出る）', () => {
    const template = applicationMenuTemplate({ platform: 'windows', active: false, actions })

    expect(items(template).filter((item) => item.label === undefined)).toEqual([])
    expect(template.map((item) => item.label)).toEqual([
      'ファイル(&F)',
      '録音(&R)',
      '編集(&E)',
      '表示(&V)',
      'ウィンドウ(&W)',
      'ヘルプ(&H)'
    ])
  })

  it('Windows のファイルメニューに終了がある', () => {
    const [file] = applicationMenuTemplate({ platform: 'windows', active: false, actions })

    expect(Array.isArray(file?.submenu) && file.submenu.some((item) => item.role === 'quit')).toBe(true)
  })

  it('英語の UI では英語の名前になる', () => {
    setAppLocale('en')
    try {
      const template = applicationMenuTemplate({ platform: 'windows', active: false, actions })
      expect(template.map((item) => item.label)).toEqual(['&File', '&Recording', '&Edit', '&View', '&Window', '&Help'])
    } finally {
      setAppLocale('ja')
    }
  })

  it('macOS の役割のメニューは OS の訳に任せ、名前を付けない', () => {
    const template = applicationMenuTemplate({ platform: 'macos', active: false, actions })

    expect(template[0]).toEqual({ role: 'appMenu' })
    expect(template.find((item) => item.role === 'editMenu')).toEqual({ role: 'editMenu' })
    expect(template.find((item) => item.role === 'windowMenu')).toEqual({ role: 'windowMenu' })
  })

  it('録音中かどうかで開始と停止の有効・無効が入れ替わる', () => {
    const recording = (active: boolean) =>
      items(applicationMenuTemplate({ platform: 'windows', active, actions })).filter(
        (item) => item.label === text().menu.start || item.label === text().menu.stop
      )

    expect(recording(false).map((item) => item.enabled)).toEqual([true, false])
    expect(recording(true).map((item) => item.enabled)).toEqual([false, true])
  })
})
