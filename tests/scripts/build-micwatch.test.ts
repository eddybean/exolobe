import { describe, expect, it } from 'vitest'
import { micwatchBuildCommand } from '../../scripts/build-micwatch.mjs'

describe('micwatchBuildCommand', () => {
  it('macOS は従来の build-micwatch.sh で Swift 版を作る', () => {
    expect(micwatchBuildCommand('darwin')).toEqual({ command: 'bash', args: ['scripts/build-micwatch.sh'] })
  })

  it('Windows は native/micwatch の Rust 版を作る', () => {
    expect(micwatchBuildCommand('win32')).toEqual({
      command: process.execPath,
      args: ['scripts/build-rust-helper.mjs', 'micwatch']
    })
  })

  it('それ以外の OS では作らない', () => {
    expect(micwatchBuildCommand('linux')).toBeUndefined()
  })
})
