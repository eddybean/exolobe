import { describe, expect, it } from 'vitest'
import {
  VC_RUNTIME_DLLS,
  bundledWhisperFiles,
  whisperBuildCommand,
  windowsCmakeArgs
} from '../../scripts/build-whisper.mjs'

describe('whisperBuildCommand', () => {
  it('macOS は従来の build-whisper.sh を bash で呼ぶ（Metal と Core ML）', () => {
    expect(whisperBuildCommand('darwin')).toEqual({ command: 'bash', args: ['scripts/build-whisper.sh'] })
  })

  it('macOS 以外では外部のスクリプトを呼ばない', () => {
    expect(whisperBuildCommand('win32')).toBeUndefined()
  })
})

describe('windowsCmakeArgs', () => {
  const args = windowsCmakeArgs('C:/src', 'C:/src/build')

  it('Vulkan を有効にする（CUDA は同梱しない、ADR-048）', () => {
    expect(args).toContain('-DGGML_VULKAN=ON')
    expect(args.some((arg) => arg.startsWith('-DGGML_CUDA=ON'))).toBe(false)
  })

  it('バックエンドを DLL に分け、Vulkan が読めない機体でも CPU で動かす', () => {
    expect(args).toEqual(expect.arrayContaining(['-DGGML_BACKEND_DL=ON', '-DBUILD_SHARED_LIBS=ON']))
  })

  it('CPU は命令セットごとの DLL を作り、実行する機体で選ばせる（ビルドした機体に合わせない）', () => {
    expect(args).toEqual(expect.arrayContaining(['-DGGML_CPU_ALL_VARIANTS=ON', '-DGGML_NATIVE=OFF']))
  })
})

describe('bundledWhisperFiles', () => {
  it('whisper-cli.exe と、それが読む whisper・ggml の DLL だけを運ぶ', () => {
    const files = [
      'whisper-cli.exe',
      'whisper-bench.exe',
      'whisper.dll',
      'ggml.dll',
      'ggml-base.dll',
      'ggml-vulkan.dll',
      'ggml-cpu-haswell.dll',
      'parakeet.dll',
      'x.pdb'
    ]

    expect(bundledWhisperFiles(files)).toEqual([
      'whisper-cli.exe',
      'whisper.dll',
      'ggml.dll',
      'ggml-base.dll',
      'ggml-vulkan.dll',
      'ggml-cpu-haswell.dll'
    ])
  })
})

describe('VC_RUNTIME_DLLS', () => {
  it('whisper-cli と DLL が読む Visual C++ ランタイムを、アプリの横に置く分だけ持つ', () => {
    expect([...VC_RUNTIME_DLLS].sort()).toEqual(['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'])
  })
})
