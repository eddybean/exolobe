import { describe, expect, it } from 'vitest'
import { devElectronPatchCommand } from '../../scripts/postinstall.mjs'

describe('devElectronPatchCommand', () => {
  it('macOS では開発用 Electron.app を直すスクリプトを bash で呼ぶ', () => {
    expect(devElectronPatchCommand('darwin')).toEqual({
      command: 'bash',
      args: ['scripts/patch-dev-electron.sh']
    })
  })

  it('macOS 以外では何もしない（Info.plist も codesign も無い）', () => {
    expect(devElectronPatchCommand('win32')).toBeUndefined()
    expect(devElectronPatchCommand('linux')).toBeUndefined()
  })
})
