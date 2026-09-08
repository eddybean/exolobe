import { describe, expect, it } from 'vitest'
import { defaultSettings, isConfigured, mergeSettings, validateSettings } from '@domain/Settings'

describe('defaultSettings', () => {
  it('保存先未選択・話者クラスタリング有効を既定にする', () => {
    const settings = defaultSettings()

    expect(settings.storageDir).toBeNull()
    expect(settings.diarization.enabled).toBe(true)
    expect(settings.audio.sampleRate).toBe(16_000)
  })

  it('無音区間の除外を既定で有効にする', () => {
    const settings = defaultSettings()

    expect(settings.transcription.vadEnabled).toBe(true)
    // モデルは初期設定画面で取得するため、既定では未設定。
    expect(settings.transcription.vadModelPath).toBe('')
  })
})

describe('isConfigured', () => {
  it('保存先が決まるまでは未設定として扱う', () => {
    expect(isConfigured(defaultSettings())).toBe(false)
    expect(isConfigured({ ...defaultSettings(), storageDir: '/Users/me/Meetings' })).toBe(true)
  })
})

describe('mergeSettings', () => {
  it('指定したキーだけを差し替え、他は保持する', () => {
    const merged = mergeSettings(defaultSettings(), {
      storageDir: '/Users/me/Meetings',
      summarization: { modelPath: '/models/qwen3-8b.gguf' }
    })

    expect(merged.storageDir).toBe('/Users/me/Meetings')
    expect(merged.summarization.modelPath).toBe('/models/qwen3-8b.gguf')
    // ネストしたグループの他のキーは失われない
    expect(merged.summarization.contextSize).toBe(defaultSettings().summarization.contextSize)
    expect(merged.transcription).toEqual(defaultSettings().transcription)
  })

  it('undefined の値は既存値を上書きしない', () => {
    const base = { ...defaultSettings(), storageDir: '/Users/me/Meetings' }
    expect(mergeSettings(base, { storageDir: undefined }).storageDir).toBe('/Users/me/Meetings')
  })
})

describe('validateSettings', () => {
  it('既定値は妥当', () => {
    expect(validateSettings(defaultSettings())).toEqual([])
  })

  it('サポート外のサンプルレートを弾く', () => {
    const settings = mergeSettings(defaultSettings(), { audio: { sampleRate: 12_345 } })
    expect(validateSettings(settings)).toContain(
      'サンプルレートは 8000, 16000, 22050, 24000, 32000, 44100, 48000 のいずれかを指定してください。'
    )
  })

  it('話者数の上限が 2 未満なら弾く', () => {
    const settings = mergeSettings(defaultSettings(), { diarization: { maxSpeakers: 1 } })
    expect(validateSettings(settings)).toContain('話者数の上限は 2 以上を指定してください。')
  })

  it('VAD モデルが未取得でも保存を妨げない', () => {
    // モデルが無ければ VAD 無しで文字起こしするだけなので、設定としては妥当。
    const settings = mergeSettings(defaultSettings(), {
      transcription: { vadEnabled: true, vadModelPath: '' }
    })
    expect(validateSettings(settings)).toEqual([])
  })

  it('要約プロンプトに文字起こしの差し込み位置が無ければ弾く', () => {
    const settings = mergeSettings(defaultSettings(), {
      summarization: { promptTemplate: '要約してください。' }
    })
    expect(validateSettings(settings)).toContain(
      '要約プロンプトには文字起こしの差し込み位置 {{transcript}} を含めてください。'
    )
  })
})

describe('memoryProtection', () => {
  it('既定は標準にする', () => {
    // 何も設定していない利用者も OS ごと固まらないよう、既定で守る。
    expect(defaultSettings().memoryProtection).toBe('standard')
  })

  it('部分更新でき、他の設定を壊さない', () => {
    const merged = mergeSettings(defaultSettings(), { memoryProtection: 'off' })

    expect(merged.memoryProtection).toBe('off')
    expect(merged.summarization).toEqual(defaultSettings().summarization)
  })

  it('未指定なら既存の値を保つ', () => {
    const base = { ...defaultSettings(), memoryProtection: 'conservative' as const }

    expect(mergeSettings(base, { storageDir: '/x' }).memoryProtection).toBe('conservative')
  })

  it('未知の値は保存前に弾く', () => {
    const settings = { ...defaultSettings(), memoryProtection: 'aggressive' } as never

    expect(validateSettings(settings).length).toBeGreaterThan(0)
  })
})

/**
 * 録りっぱなしの見張り。既定で有効にしないと「止め忘れを防ぐ」目的を果たさないため、
 * 既定値そのものを仕様として固定する。
 */
describe('startAlert', () => {
  it('マイク使用の見張りを既定で有効にし、1 分半で知らせる', () => {
    const settings = defaultSettings()

    expect(settings.recording.startAlertEnabled).toBe(true)
    expect(settings.recording.startAlertDelayMs).toBe(90_000)
  })

  it('知らせるまでの時間が 30 秒未満なら弾く', () => {
    const base = defaultSettings()
    const settings = { ...base, recording: { ...base.recording, startAlertDelayMs: 10_000 } }

    expect(validateSettings(settings)).toContain(
      '録音を促すまでの時間は 30 秒以上を指定してください。'
    )
  })
})

describe('silenceAlert', () => {
  it('無音の見張りを既定で有効にし、5 分で知らせる', () => {
    const settings = defaultSettings()

    expect(settings.recording.silenceAlertEnabled).toBe(true)
    expect(settings.recording.silenceDurationMs).toBe(300_000)
  })

  it('グループ単位で部分更新できる', () => {
    const merged = mergeSettings(defaultSettings(), {
      recording: { silenceDurationMs: 600_000 }
    })

    expect(merged.recording.silenceDurationMs).toBe(600_000)
    expect(merged.recording.silenceAlertEnabled).toBe(true)
  })

  it('短すぎる無音時間を弾く', () => {
    const settings = mergeSettings(defaultSettings(), { recording: { silenceDurationMs: 30_000 } })

    expect(validateSettings(settings)).toContain('無音を知らせるまでの時間は 1 分以上を指定してください。')
  })
})
