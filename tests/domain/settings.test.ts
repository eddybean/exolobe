import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CLUSTERING_THRESHOLD,
  DEFAULT_SUMMARY_PROMPT,
  defaultSettings,
  isConfigured,
  mergeSettings,
  NOTES_PLACEHOLDER,
  validateSettings
} from '@domain/Settings'
import { VOICEPRINT_MATCH_THRESHOLD } from '@domain/Voiceprint'

describe('defaultSettings', () => {
  it('保存先未選択・話者クラスタリング有効を既定にする', () => {
    const settings = defaultSettings()

    expect(settings.storageDir).toBeNull()
    expect(settings.diarization.enabled).toBe(true)
    expect(settings.diarization.voiceprintThreshold).toBe(VOICEPRINT_MATCH_THRESHOLD)
    expect(settings.diarization.clusteringThreshold).toBe(DEFAULT_CLUSTERING_THRESHOLD)
    expect(settings.audio.sampleRate).toBe(16_000)
  })

  it('無音区間の除外を既定で有効にする', () => {
    const settings = defaultSettings()

    expect(settings.transcription.vadEnabled).toBe(true)
    // モデルは初期設定画面で取得するため、既定では未設定。
    expect(settings.transcription.vadModelPath).toBe('')
  })

  it('用語集は既定で空にする', () => {
    expect(defaultSettings().transcription.glossary).toEqual([])
  })

  it('意味検索は既定で無効にする', () => {
    const settings = defaultSettings()

    // 600MB 超のモデルの取得と、全録音のベクトル化を利用者の同意なしに始めない。
    expect(settings.search.enabled).toBe(false)
    expect(settings.search.modelPath).toBe('')
  })

  it('カレンダー連携と録音の自動開始は既定で切にする', () => {
    const { recording } = defaultSettings()

    // 自動開始は ADR-025 / ADR-027 の「勝手に始めない」を外す選択なので、利用者が選んだときだけ（ADR-041）。
    expect(recording.calendarEnabled).toBe(false)
    expect(recording.autoStartEnabled).toBe(false)
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

  it('意味検索の設定をグループ単位でマージする', () => {
    const merged = mergeSettings(defaultSettings(), { search: { enabled: true } })

    expect(merged.search.enabled).toBe(true)
    expect(merged.search.modelPath).toBe('')
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
      'sampleRate'
    )
  })

  it('話者数の上限が 2 未満なら弾く', () => {
    const settings = mergeSettings(defaultSettings(), { diarization: { maxSpeakers: 1 } })
    expect(validateSettings(settings)).toContain('maxSpeakers')
  })

  it('声紋の一致閾値が範囲外なら弾く', () => {
    for (const voiceprintThreshold of [0, 1.2]) {
      const settings = mergeSettings(defaultSettings(), { diarization: { voiceprintThreshold } })
      expect(validateSettings(settings)).toContain(
        'voiceprintThreshold'
      )
    }
  })

  it('話者を分ける近さが範囲外なら弾く', () => {
    for (const clusteringThreshold of [0, 1.2]) {
      const settings = mergeSettings(defaultSettings(), { diarization: { clusteringThreshold } })
      expect(validateSettings(settings)).toContain(
        'clusteringThreshold'
      )
    }
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
      'promptPlaceholder'
    )
  })
})

describe('DEFAULT_SUMMARY_PROMPT', () => {
  it('会議中のメモと印の差し込み位置を持つ', () => {
    expect(DEFAULT_SUMMARY_PROMPT).toContain(NOTES_PLACEHOLDER)
  })

  it('メモは必須にしない（{{notes}} を消したプロンプトも保存できる）', () => {
    const settings = mergeSettings(defaultSettings(), {
      summarization: { promptTemplate: '要約してください。{{transcript}}' }
    })
    expect(validateSettings(settings)).toEqual([])
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
 * どのアプリを見ていても録音を始め・止められるショートカット。会議の最中に
 * ウィンドウを探させないためのものなので、既定で有効にする。
 */
describe('globalShortcut', () => {
  it('グローバルショートカットを既定で有効にする', () => {
    expect(defaultSettings().recording.globalShortcutEnabled).toBe(true)
  })

  it('以前の設定ファイル（項目が無い）でも既定値で補う', () => {
    const settings = mergeSettings(defaultSettings(), { recording: { silenceAlertEnabled: false } })

    expect(settings.recording.globalShortcutEnabled).toBe(true)
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
      'startAlertDelay'
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

    expect(validateSettings(settings)).toContain('silenceDuration')
  })
})
