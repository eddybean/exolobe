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
  const vulkan = { VULKAN_SDK: 'C:/VulkanSDK/1.4.363.0' }

  it('道具が揃っていれば注意を出さない', () => {
    const report = windowsSetupReport({ env: vulkan, onPath: everything, whisperBuilt: false })

    expect(report.filter((item) => item.level === 'warn')).toEqual([])
  })

  it('ELECTRON_RUN_AS_NODE があれば、npm run dev が起動しないことを知らせる', () => {
    const report = windowsSetupReport({
      env: { ...vulkan, ELECTRON_RUN_AS_NODE: '1' },
      onPath: everything,
      whisperBuilt: false
    })

    expect(report).toContainEqual(expect.objectContaining({ level: 'warn', subject: 'ELECTRON_RUN_AS_NODE' }))
  })

  it('whisper-cli が PATH にも resources/bin にも無ければ知らせる（文字起こしだけが動かない）', () => {
    const report = windowsSetupReport({ env: vulkan, onPath: (name) => name !== 'whisper-cli', whisperBuilt: false })

    expect(report).toContainEqual(expect.objectContaining({ level: 'warn', subject: 'whisper-cli' }))
  })

  it('npm run build:whisper で作ったものが resources/bin にあれば、PATH に無くてもよい', () => {
    const report = windowsSetupReport({ env: vulkan, onPath: (name) => name !== 'whisper-cli', whisperBuilt: true })

    expect(report).toContainEqual(expect.objectContaining({ level: 'ok', subject: 'whisper-cli' }))
  })

  it('cargo が無ければ、補助プログラムをビルドできないことを知らせる', () => {
    const report = windowsSetupReport({ env: vulkan, onPath: (name) => name !== 'cargo', whisperBuilt: false })

    expect(report).toContainEqual(expect.objectContaining({ level: 'warn', subject: 'cargo' }))
  })

  it('Vulkan SDK が無ければ、whisper-cli をビルドできないことを知らせる', () => {
    const report = windowsSetupReport({ env: {}, onPath: everything, whisperBuilt: false })

    expect(report).toContainEqual(expect.objectContaining({ level: 'warn', subject: 'Vulkan SDK' }))
  })

  it('何も無くても、確かめた項目はすべて報告する', () => {
    const report = windowsSetupReport({ env: {}, onPath: nothing, whisperBuilt: false })

    expect(report.map((item) => item.subject)).toEqual(['whisper-cli', 'cargo', 'Vulkan SDK'])
  })
})
