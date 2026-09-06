import { describe, expect, it } from 'vitest'
import { defaultSettings, isConfigured, mergeSettings, validateSettings } from '@domain/Settings'

describe('defaultSettings', () => {
  it('保存先未選択・話者クラスタリング有効を既定にする', () => {
    const settings = defaultSettings()

    expect(settings.storageDir).toBeNull()
    expect(settings.diarization.enabled).toBe(true)
    expect(settings.audio.sampleRate).toBe(16_000)
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

  it('要約プロンプトに文字起こしの差し込み位置が無ければ弾く', () => {
    const settings = mergeSettings(defaultSettings(), {
      summarization: { promptTemplate: '要約してください。' }
    })
    expect(validateSettings(settings)).toContain(
      '要約プロンプトには文字起こしの差し込み位置 {{transcript}} を含めてください。'
    )
  })
})
