import { describe, expect, it } from 'vitest'
import { setupCommand, windowsSetupReport } from '../../scripts/setup.mjs'

describe('setupCommand', () => {
  it('macOS では従来の setup.sh を bash で呼ぶ（Homebrew と sw_vers が前提）', () => {
    expect(setupCommand('darwin')).toEqual({ command: 'bash', args: ['scripts/setup.sh'] })
  })

  it('macOS 以外では外部のスクリプトを呼ばない', () => {
    expect(setupCommand('win32')).toBeUndefined()
    expect(setupCommand('linux')).toBeUndefined()
  })
})

describe('windowsSetupReport', () => {
  const everything = (): boolean => true
  const nothing = (): boolean => false

  it('道具が揃っていれば注意を出さない', () => {
    const report = windowsSetupReport({ env: {}, onPath: everything })

    expect(report.filter((item) => item.level === 'warn')).toEqual([])
  })

  it('ELECTRON_RUN_AS_NODE があれば、npm run dev が起動しないことを知らせる', () => {
    const report = windowsSetupReport({ env: { ELECTRON_RUN_AS_NODE: '1' }, onPath: everything })

    expect(report).toContainEqual(expect.objectContaining({ level: 'warn', subject: 'ELECTRON_RUN_AS_NODE' }))
  })

  it('whisper-cli が PATH に無ければ知らせる（文字起こしだけが動かない）', () => {
    const report = windowsSetupReport({ env: {}, onPath: (name) => name !== 'whisper-cli' })

    expect(report).toContainEqual(expect.objectContaining({ level: 'warn', subject: 'whisper-cli' }))
  })

  it('cargo が無ければ、補助プログラムをビルドできないことを知らせる', () => {
    const report = windowsSetupReport({ env: {}, onPath: (name) => name !== 'cargo' })

    expect(report).toContainEqual(expect.objectContaining({ level: 'warn', subject: 'cargo' }))
  })

  it('何も無くても、確かめた項目はすべて報告する', () => {
    const report = windowsSetupReport({ env: {}, onPath: nothing })

    expect(report.map((item) => item.subject)).toEqual(['whisper-cli', 'cargo'])
  })
})
