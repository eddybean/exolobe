import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CLUSTERING_THRESHOLD,
  DEFAULT_SUMMARY_PROMPT,
  DEFAULT_SUMMARY_PROMPT_EN,
  NOTES_PLACEHOLDER,
  TRANSCRIPT_PLACEHOLDER,
  appearanceOf,
  updateCheckIntervalOf,
  isDefaultSummaryPrompt,
  settingsSummaryPrompt,
  summaryPromptFor,
  defaultSettings,
  isConfigured,
  mergeSettings,
  validateSettings
} from '@domain/Settings'
import { VOICEPRINT_MATCH_THRESHOLD } from '@domain/Voiceprint'

describe('defaultSettings', () => {
  it('保存先未選択・話者クラスタリング有効を既定にする', () => {
    const settings = defaultSettings('ja')

    expect(settings.storageDir).toBeNull()
    expect(settings.diarization.enabled).toBe(true)
    expect(settings.diarization.voiceprintThreshold).toBe(VOICEPRINT_MATCH_THRESHOLD)
    expect(settings.diarization.clusteringThreshold).toBe(DEFAULT_CLUSTERING_THRESHOLD)
    expect(settings.audio.sampleRate).toBe(16_000)
  })

  it('無音区間の除外を既定で有効にする', () => {
    const settings = defaultSettings('ja')

    expect(settings.transcription.vadEnabled).toBe(true)
    // モデルは初期設定画面で取得するため、既定では未設定。
    expect(settings.transcription.vadModelPath).toBe('')
  })

  it('用語集は既定で空にする', () => {
    expect(defaultSettings('ja').transcription.glossary).toEqual([])
  })

  it('意味検索は既定で無効にする', () => {
    const settings = defaultSettings('ja')

    // 600MB 超のモデルの取得と、全録音のベクトル化を利用者の同意なしに始めない。
    expect(settings.search.enabled).toBe(false)
    expect(settings.search.modelPath).toBe('')
  })

  it('カレンダー連携と録音の自動開始は既定で切にする', () => {
    const { recording } = defaultSettings('ja')

    // 自動開始は ADR-025 / ADR-027 の「勝手に始めない」を外す選択なので、利用者が選んだときだけ（ADR-041）。
    expect(recording.calendarEnabled).toBe(false)
    expect(recording.autoStartEnabled).toBe(false)
  })
})

describe('isConfigured', () => {
  it('保存先が決まるまでは未設定として扱う', () => {
    expect(isConfigured(defaultSettings('ja'))).toBe(false)
    expect(isConfigured({ ...defaultSettings('ja'), storageDir: '/Users/me/Meetings' })).toBe(true)
  })
})

describe('mergeSettings', () => {
  it('指定したキーだけを差し替え、他は保持する', () => {
    const merged = mergeSettings(defaultSettings('ja'), {
      storageDir: '/Users/me/Meetings',
      summarization: { modelPath: '/models/qwen3-8b.gguf' }
    })

    expect(merged.storageDir).toBe('/Users/me/Meetings')
    expect(merged.summarization.modelPath).toBe('/models/qwen3-8b.gguf')
    // ネストしたグループの他のキーは失われない
    expect(merged.summarization.contextSize).toBe(defaultSettings('ja').summarization.contextSize)
    expect(merged.transcription).toEqual(defaultSettings('ja').transcription)
  })

  it('意味検索の設定をグループ単位でマージする', () => {
    const merged = mergeSettings(defaultSettings('ja'), { search: { enabled: true } })

    expect(merged.search.enabled).toBe(true)
    expect(merged.search.modelPath).toBe('')
  })

  it('undefined の値は既存値を上書きしない', () => {
    const base = { ...defaultSettings('ja'), storageDir: '/Users/me/Meetings' }
    expect(mergeSettings(base, { storageDir: undefined }).storageDir).toBe('/Users/me/Meetings')
  })
})

describe('validateSettings', () => {
  it('既定値は妥当', () => {
    expect(validateSettings(defaultSettings('ja'))).toEqual([])
  })

  it('サポート外のサンプルレートを弾く', () => {
    const settings = mergeSettings(defaultSettings('ja'), { audio: { sampleRate: 12_345 } })
    expect(validateSettings(settings)).toContain(
      'sampleRate'
    )
  })

  it('話者数の上限が 2 未満なら弾く', () => {
    const settings = mergeSettings(defaultSettings('ja'), { diarization: { maxSpeakers: 1 } })
    expect(validateSettings(settings)).toContain('maxSpeakers')
  })

  it('声紋の一致閾値が範囲外なら弾く', () => {
    for (const voiceprintThreshold of [0, 1.2]) {
      const settings = mergeSettings(defaultSettings('ja'), { diarization: { voiceprintThreshold } })
      expect(validateSettings(settings)).toContain(
        'voiceprintThreshold'
      )
    }
  })

  it('話者を分ける近さが範囲外なら弾く', () => {
    for (const clusteringThreshold of [0, 1.2]) {
      const settings = mergeSettings(defaultSettings('ja'), { diarization: { clusteringThreshold } })
      expect(validateSettings(settings)).toContain(
        'clusteringThreshold'
      )
    }
  })

  it('VAD モデルが未取得でも保存を妨げない', () => {
    // モデルが無ければ VAD 無しで文字起こしするだけなので、設定としては妥当。
    const settings = mergeSettings(defaultSettings('ja'), {
      transcription: { vadEnabled: true, vadModelPath: '' }
    })
    expect(validateSettings(settings)).toEqual([])
  })

  it('要約プロンプトに文字起こしの差し込み位置が無ければ弾く', () => {
    const settings = mergeSettings(defaultSettings('ja'), {
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
    const settings = mergeSettings(defaultSettings('ja'), {
      summarization: { promptTemplate: '要約してください。{{transcript}}' }
    })
    expect(validateSettings(settings)).toEqual([])
  })
})

describe('memoryProtection', () => {
  it('既定は標準にする', () => {
    // 何も設定していない利用者も OS ごと固まらないよう、既定で守る。
    expect(defaultSettings('ja').memoryProtection).toBe('standard')
  })

  it('部分更新でき、他の設定を壊さない', () => {
    const merged = mergeSettings(defaultSettings('ja'), { memoryProtection: 'off' })

    expect(merged.memoryProtection).toBe('off')
    expect(merged.summarization).toEqual(defaultSettings('ja').summarization)
  })

  it('未指定なら既存の値を保つ', () => {
    const base = { ...defaultSettings('ja'), memoryProtection: 'conservative' as const }

    expect(mergeSettings(base, { storageDir: '/x' }).memoryProtection).toBe('conservative')
  })

  it('未知の値は保存前に弾く', () => {
    const settings = { ...defaultSettings('ja'), memoryProtection: 'aggressive' } as never

    expect(validateSettings(settings).length).toBeGreaterThan(0)
  })
})

/**
 * 画面の明暗。OS に従うのが既定で、アプリだけ明るく・暗くしたい人が固定できる。
 */
describe('appearance', () => {
  it('既定は OS の設定に従う', () => {
    expect(defaultSettings('ja').appearance).toBe('system')
  })

  it('部分更新でき、未指定なら既存の値を保つ', () => {
    const dark = mergeSettings(defaultSettings('ja'), { appearance: 'dark' })

    expect(dark.appearance).toBe('dark')
    expect(mergeSettings(dark, { storageDir: '/x' }).appearance).toBe('dark')
  })

  it('未知の値は保存前に弾く', () => {
    const settings = { ...defaultSettings('ja'), appearance: 'sepia' } as never

    expect(validateSettings(settings)).toEqual(['appearance'])
  })

  it('読み込んだ値が未知なら OS の設定に従う', () => {
    // 新しい版が足した値を古い版が読んだとき、起動時の反映で落とさない。
    const settings = { ...defaultSettings('ja'), appearance: 'sepia' } as never

    expect(appearanceOf(settings)).toBe('system')
    expect(appearanceOf({ ...defaultSettings('ja'), appearance: 'light' })).toBe('light')
  })
})

/**
 * 新しい版の確認の間隔（ADR-044）。週 1 回を既定にし、1 日から「確認しない」まで選べる。
 */
describe('updateCheck', () => {
  it('既定は週 1 回', () => {
    expect(defaultSettings('ja').updateCheck).toBe('weekly')
  })

  it('部分更新でき、未指定なら既存の値を保つ', () => {
    const never = mergeSettings(defaultSettings('ja'), { updateCheck: 'never' })

    expect(never.updateCheck).toBe('never')
    expect(mergeSettings(never, { storageDir: '/x' }).updateCheck).toBe('never')
  })

  it('未知の値は保存前に弾く', () => {
    const settings = { ...defaultSettings('ja'), updateCheck: 'hourly' } as never

    expect(validateSettings(settings)).toEqual(['updateCheck'])
  })

  it('読み込んだ値が未知なら週 1 回として扱う', () => {
    const settings = { ...defaultSettings('ja'), updateCheck: 'hourly' } as never

    expect(updateCheckIntervalOf(settings)).toBe('weekly')
    expect(updateCheckIntervalOf({ ...defaultSettings('ja'), updateCheck: 'never' })).toBe('never')
  })
})

/**
 * どのアプリを見ていても録音を始め・止められるショートカット。会議の最中に
 * ウィンドウを探させないためのものなので、既定で有効にする。
 */
describe('globalShortcut', () => {
  it('グローバルショートカットを既定で有効にする', () => {
    expect(defaultSettings('ja').recording.globalShortcutEnabled).toBe(true)
  })

  it('以前の設定ファイル（項目が無い）でも既定値で補う', () => {
    const settings = mergeSettings(defaultSettings('ja'), { recording: { silenceAlertEnabled: false } })

    expect(settings.recording.globalShortcutEnabled).toBe(true)
  })
})

/**
 * 録りっぱなしの見張り。既定で有効にしないと「止め忘れを防ぐ」目的を果たさないため、
 * 既定値そのものを仕様として固定する。
 */
describe('startAlert', () => {
  it('マイク使用の見張りを既定で有効にし、1 分半で知らせる', () => {
    const settings = defaultSettings('ja')

    expect(settings.recording.startAlertEnabled).toBe(true)
    expect(settings.recording.startAlertDelayMs).toBe(90_000)
  })

  it('知らせるまでの時間が 30 秒未満なら弾く', () => {
    const base = defaultSettings('ja')
    const settings = { ...base, recording: { ...base.recording, startAlertDelayMs: 10_000 } }

    expect(validateSettings(settings)).toContain(
      'startAlertDelay'
    )
  })
})

describe('silenceAlert', () => {
  it('無音の見張りを既定で有効にし、5 分で知らせる', () => {
    const settings = defaultSettings('ja')

    expect(settings.recording.silenceAlertEnabled).toBe(true)
    expect(settings.recording.silenceDurationMs).toBe(300_000)
  })

  it('グループ単位で部分更新できる', () => {
    const merged = mergeSettings(defaultSettings('ja'), {
      recording: { silenceDurationMs: 600_000 }
    })

    expect(merged.recording.silenceDurationMs).toBe(600_000)
    expect(merged.recording.silenceAlertEnabled).toBe(true)
  })

  it('短すぎる無音時間を弾く', () => {
    const settings = mergeSettings(defaultSettings('ja'), { recording: { silenceDurationMs: 30_000 } })

    expect(validateSettings(settings)).toContain('silenceDuration')
  })
})

/**
 * 新しく入れた人の文字起こしの言語は UI の言語に合わせる（ADR-043）。settings.json は
 * 全体を保存するので、一度でも保存した人の言語は OS の言語を変えても動かない。
 */
describe('defaultSettings の言語', () => {
  it('日本語なら日本語の文字起こしと日本語の要約プロンプト', () => {
    const settings = defaultSettings('ja')
    expect(settings.transcription.language).toBe('ja')
    expect(settings.summarization.promptTemplate).toBe(DEFAULT_SUMMARY_PROMPT)
  })

  it('英語なら英語の文字起こしと英語の要約プロンプト', () => {
    const settings = defaultSettings('en')
    expect(settings.transcription.language).toBe('en')
    expect(settings.summarization.promptTemplate).toBe(DEFAULT_SUMMARY_PROMPT_EN)
  })
})

describe('要約プロンプトの言語', () => {
  it('英語の既定プロンプトも差し込み位置を持ち、英語で書くよう指示する', () => {
    expect(DEFAULT_SUMMARY_PROMPT_EN).toContain(TRANSCRIPT_PLACEHOLDER)
    expect(DEFAULT_SUMMARY_PROMPT_EN).toContain(NOTES_PLACEHOLDER)
    expect(DEFAULT_SUMMARY_PROMPT_EN).toContain('in English')
  })

  it('既定のプロンプトのままなら、会議の言語の既定プロンプトに差し替える', () => {
    expect(summaryPromptFor(DEFAULT_SUMMARY_PROMPT, 'en')).toBe(DEFAULT_SUMMARY_PROMPT_EN)
    expect(summaryPromptFor(DEFAULT_SUMMARY_PROMPT_EN, 'ja')).toBe(DEFAULT_SUMMARY_PROMPT)
    expect(summaryPromptFor(DEFAULT_SUMMARY_PROMPT, 'ja')).toBe(DEFAULT_SUMMARY_PROMPT)
  })

  /** 利用者が書き換えたプロンプトは、言語が違っても書いたとおりに使う（翻訳しない）。 */
  it('書き換えたプロンプトは言語にかかわらずそのまま使う', () => {
    const custom = `箇条書きで要約して\n${TRANSCRIPT_PLACEHOLDER}`
    expect(summaryPromptFor(custom, 'en')).toBe(custom)
  })

  it('既定かどうかは前後の空白の違いを無視して判定する', () => {
    expect(isDefaultSummaryPrompt(`${DEFAULT_SUMMARY_PROMPT}\n`)).toBe(true)
    expect(isDefaultSummaryPrompt(`${DEFAULT_SUMMARY_PROMPT_EN}  `)).toBe(true)
    expect(isDefaultSummaryPrompt('要約して {{transcript}}')).toBe(false)
  })
})

/** 設定画面の要約プロンプト欄と要約の実行で、同じプロンプトを使う。 */
describe('settingsSummaryPrompt', () => {
  it('文字起こしの言語から会議の言語を決めてプロンプトを選ぶ', () => {
    const settings = mergeSettings(defaultSettings('ja'), { transcription: { language: 'en' } })
    expect(settingsSummaryPrompt(settings, 'ja')).toBe(DEFAULT_SUMMARY_PROMPT_EN)
  })

  it('自動判定なら UI の言語に従う', () => {
    const settings = mergeSettings(defaultSettings('ja'), { transcription: { language: 'auto' } })
    expect(settingsSummaryPrompt(settings, 'en')).toBe(DEFAULT_SUMMARY_PROMPT_EN)
    expect(settingsSummaryPrompt(settings, 'ja')).toBe(DEFAULT_SUMMARY_PROMPT)
  })
})
