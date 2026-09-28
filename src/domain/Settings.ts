import type { SettingsProblem } from '@domain/errors'
import { isUpdateCheckInterval, type UpdateCheckInterval } from '@domain/AppUpdate'
import { meetingLanguageOf, type MeetingLanguage } from '@domain/MeetingLanguage'
import { isMemoryProtection, type MemoryProtection } from '@domain/MemoryGuard'
import { VOICEPRINT_MATCH_THRESHOLD } from '@domain/Voiceprint'

/** audiotee が受け付けるサンプルレート。whisper は 16kHz を前提とするためこれが既定。 */
export const SUPPORTED_SAMPLE_RATES: readonly number[] = [
  8_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000
]

/** 要約プロンプト内で文字起こし本文に置き換えられるプレースホルダ。 */
export const TRANSCRIPT_PLACEHOLDER = '{{transcript}}'

/**
 * 要約プロンプト内で、録音中に書いたメモと印（ADR-042）に置き換えられるプレースホルダ。
 * 必須にはしない。これを足す前にプロンプトを保存した利用者もいるので、無ければ末尾に付ける。
 */
export const NOTES_PLACEHOLDER = '{{notes}}'

export const DEFAULT_SUMMARY_PROMPT = [
  'あなたは会議の議事録作成者です。以下の文字起こしから日本語で議事録を作成してください。',
  '',
  '出力は次の Markdown 見出し構成に厳密に従ってください。',
  '## 概要',
  '## 決定事項',
  '## ToDo（担当者と期限が分かる場合は併記）',
  '## 議論の流れ',
  '',
  '文字起こしに書かれていないことは推測せず、不明な点は「不明」と記載してください。',
  '',
  NOTES_PLACEHOLDER,
  '',
  '---',
  TRANSCRIPT_PLACEHOLDER
].join('\n')

/** 英語の会議の既定。見出しの構成は日本語版と揃える（チャットが節を見出しの語で探すため）。 */
export const DEFAULT_SUMMARY_PROMPT_EN = [
  'You write meeting minutes. Write the minutes in English from the transcript below.',
  '',
  'Follow this Markdown heading structure exactly.',
  '## Overview',
  '## Decisions',
  '## To-dos (include the owner and due date when known)',
  '## Discussion',
  '',
  'Do not guess anything that is not in the transcript; write "Unknown" where something is unclear.',
  '',
  NOTES_PLACEHOLDER,
  '',
  '---',
  TRANSCRIPT_PLACEHOLDER
].join('\n')

const DEFAULT_SUMMARY_PROMPTS: Readonly<Record<MeetingLanguage, string>> = {
  ja: DEFAULT_SUMMARY_PROMPT,
  en: DEFAULT_SUMMARY_PROMPT_EN
}

/**
 * 同梱の既定プロンプトのままか。
 *
 * 保存される設定には既定かどうかの印が無く、全文が入っている。既定の全文と一致するものを
 * 「利用者が書いていない」とみなす。編集欄を触っただけで末尾の空白が変わることがあるので、
 * 前後の空白は無視する。
 */
export const isDefaultSummaryPrompt = (template: string): boolean =>
  Object.values(DEFAULT_SUMMARY_PROMPTS).some((prompt) => prompt === template.trim())

/**
 * 会議の言語で使う要約プロンプト（ADR-043）。
 *
 * 既定のままなら会議の言語の既定に差し替える。日本語の既定には「日本語で」と書いてあり、
 * 英語の会議の要約まで日本語になる。利用者が書き換えたプロンプトは、書いたとおりに使う。
 */
export const summaryPromptFor = (template: string, language: MeetingLanguage): string =>
  isDefaultSummaryPrompt(template) ? DEFAULT_SUMMARY_PROMPTS[language] : template

/**
 * 設定から、要約に使うプロンプトを決める。設定画面の編集欄と要約の実行で同じものを見せるため。
 *
 * @param uiLanguage 文字起こしの言語が自動判定のときに従う UI の言語
 */
export const settingsSummaryPrompt = (settings: Settings, uiLanguage: MeetingLanguage): string =>
  summaryPromptFor(
    settings.summarization.promptTemplate,
    meetingLanguageOf(settings.transcription.language, uiLanguage)
  )

/**
 * 話者分割のクラスタリングで「同じ人」とみなす距離の上限。
 *
 * sherpa-onnx は埋め込みどうしの距離がこの値を下回る間だけクラスタを併合する。
 * 上げるほど併合が進んで話者が減り（同じ人が別人に割れにくくなる）、下げるほど
 * 増える。0.5 は sherpa-onnx の既定で、会議音声ではここから動かす必要が出るのは
 * 声質の近い参加者が混ざるときに限られる。
 */
export const DEFAULT_CLUSTERING_THRESHOLD = 0.5

export interface TranscriptionSettings {
  /** 差し替え可能にするための識別子。将来クラウド実装を足す際の分岐キー。 */
  readonly provider: 'whisper-cpp'
  readonly binaryPath: string
  readonly modelPath: string
  /** whisper に渡す言語コード。`auto` で自動判定。 */
  readonly language: string
  /**
   * 無音区間を whisper に渡さない（VAD）。
   *
   * 会議では自分も相手も大半の時間は喋っていない。無音をそのまま whisper に
   * 通すと「ご視聴ありがとうございました」のような、学習データ由来の文が
   * 生成されて議事録に混ざる。既定で有効にする。
   */
  readonly vadEnabled: boolean
  /** VAD モデル（ggml 形式の Silero）のパス。未取得なら空文字。 */
  readonly vadModelPath: string
  /**
   * 文字起こしに先に見せておく用語（社名・製品名・人名・略語）。
   *
   * 音が近い一般語に化けるのを防ぐためのもので、whisper の initial prompt に渡る。
   * 変換の規則は `@domain/Glossary`。
   */
  readonly glossary: readonly string[]
}

export interface SummarizationSettings {
  readonly provider: 'llama-cpp'
  readonly modelPath: string
  readonly contextSize: number
  readonly promptTemplate: string
}

/**
 * 録音そのものの振る舞い。
 *
 * 押し忘れは両方向に起きる。止め忘れれば無音だけの長い録音が残り、
 * 始め忘れれば会議の内容そのものが失われる。どちらも知らせるだけにとどめ、
 * 勝手に止めたり始めたりはしない。
 */
export interface RecordingSettings {
  readonly silenceAlertEnabled: boolean
  /** この時間ずっと無音なら知らせる。 */
  readonly silenceDurationMs: number
  /** 他のアプリがマイクを使い続けているとき、録音を促すかどうか。 */
  readonly startAlertEnabled: boolean
  /** この時間ずっとマイクが使われていたら録音を促す。 */
  readonly startAlertDelayMs: number
  /**
   * どのアプリを見ていても録音を開始・停止できるキー操作を使うかどうか。
   * 他のアプリから同じキーを奪うので、ぶつかる人が切れるようにしておく。
   */
  readonly globalShortcutEnabled: boolean
  /**
   * 録音開始時にカレンダーの予定を引き、タイトルと参加者名を埋めるかどうか。
   * カレンダーの権限を求めることになるので、利用者が選んだときだけ使う（ADR-040）。
   */
  readonly calendarEnabled: boolean
  /**
   * 会議の URL を含む予定の時間帯にマイクが使われたら、録音を自動で始めるかどうか（ADR-041）。
   * カレンダー連携が切なら効かない。ADR-025 / ADR-027 の「勝手に始めない」を利用者が
   * 自分で外す選択なので、既定は切。
   */
  readonly autoStartEnabled: boolean
}

export interface DiarizationSettings {
  readonly enabled: boolean
  readonly maxSpeakers: number
  readonly segmentationModelPath: string
  readonly embeddingModelPath: string
  /**
   * 声紋帳の名前を自動で当てにいく下限（コサイン類似度）。
   * 上げるほど取りこぼすが、別人の名前を書き込む危険は減る（ADR-031）。
   */
  readonly voiceprintThreshold: number
  /**
   * 同じ人とみなす声の距離の上限。上げるほど話者がまとまり、下げるほど割れる。
   * 声紋帳との照合（`voiceprintThreshold`）とは別で、こちらは 1 つの録音の中だけに効く。
   */
  readonly clusteringThreshold: number
}

/**
 * afconvert のコーデック指定。
 * - `aac`  : AAC-LC。指定ビットレートを守り 16kHz を保つ。会議音声の既定。
 * - `aach` : HE-AAC。より小さくなるがコアが 8kHz に落ち、指定ビットレートも守られない。
 */
export type AudioCodec = 'aac' | 'aach'

export interface AudioSettings {
  readonly sampleRate: number
  readonly codec: AudioCodec
  /** AAC-LC のビットレート。16kHz mono 32kbps で 1 時間あたり約 14MB。 */
  readonly bitrateKbps: number
}

/**
 * 自然文で録音を探す意味検索。
 *
 * 有効なのにモデルが無い状態は validate では弾かない。モデルの削除は検証を通らない
 * 経路で modelPath を空にするため、弾くと利用者が設定を保存できなくなる。
 * 実行時にモデル未取得として扱う（VAD と同じ）。
 */
export interface SearchSettings {
  readonly enabled: boolean
  /** 埋め込みモデル（GGUF）のパス。未取得なら空文字。 */
  readonly modelPath: string
}

/**
 * ライブラリ全体に問いかけるチャット。
 *
 * 要約と同じモデルを使い回すので追加のダウンロードが無く、既定で有効にできる。
 */
export interface ChatSettings {
  readonly enabled: boolean
  /** 1 回の問いで文脈に載せる録音の上限。 */
  readonly maxRecordings: number
}

/**
 * 画面の明暗。`system` は OS の設定（外観）に従う。
 *
 * 会議中に画面共有するとき、OS はダークのままアプリだけ明るくしたい、という使い方がある。
 */
export type Appearance = 'system' | 'light' | 'dark'

export const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark']

const isAppearance = (value: unknown): value is Appearance =>
  APPEARANCES.includes(value as Appearance)

/**
 * 反映する明暗。読み込んだ設定は検証を通らないので、知らない値（新しい版が足したもの）なら
 * OS に従う。そのまま Electron に渡すと例外で起動が止まる。
 */
export const appearanceOf = (settings: Settings): Appearance =>
  isAppearance(settings.appearance) ? settings.appearance : 'system'

/**
 * 新しい版を確かめる間隔。読み込んだ設定は検証を通らないので、知らない値なら既定（週 1 回）に倒す。
 * 「確認しない」に倒さないのは、古い版のまま使い続ける人を残さないため（ADR-044）。
 */
export const updateCheckIntervalOf = (settings: Settings): UpdateCheckInterval =>
  isUpdateCheckInterval(settings.updateCheck) ? settings.updateCheck : 'weekly'

export interface Settings {
  /** ユーザーが初期設定で選ぶ保存先。未選択なら null。 */
  readonly storageDir: string | null
  readonly appearance: Appearance
  /** 新しい版を GitHub Releases に確かめる間隔（ADR-044）。 */
  readonly updateCheck: UpdateCheckInterval
  /**
   * 重い推論の前に空きメモリを確認する強さ。
   *
   * 文字起こしと要約の両方に効くため、どのグループにも属さない。
   */
  readonly memoryProtection: MemoryProtection
  readonly recording: RecordingSettings
  readonly transcription: TranscriptionSettings
  readonly summarization: SummarizationSettings
  readonly diarization: DiarizationSettings
  readonly audio: AudioSettings
  readonly search: SearchSettings
  readonly chat: ChatSettings
}

/**
 * グループ単位で部分更新できるようにした設定パッチ。
 * IPC や JSON 経由ではキーが存在したまま値だけ undefined になり得るため、
 * 各キーは明示的に undefined を許容する（mergeSettings が既存値を保つ）。
 */
export type SettingsPatch = {
  readonly storageDir?: string | null | undefined
  readonly appearance?: Appearance | undefined
  readonly updateCheck?: UpdateCheckInterval | undefined
  readonly memoryProtection?: MemoryProtection | undefined
  readonly recording?: Partial<RecordingSettings>
  readonly transcription?: Partial<TranscriptionSettings>
  readonly summarization?: Partial<SummarizationSettings>
  readonly diarization?: Partial<DiarizationSettings>
  readonly audio?: Partial<AudioSettings>
  readonly search?: Partial<SearchSettings>
  readonly chat?: Partial<ChatSettings>
}

/**
 * 既定の設定。`language` は新しく入れた人の文字起こしの言語で、UI の言語を渡す（ADR-043）。
 * settings.json は全体を保存するので、一度保存した人の言語は OS の言語を変えても動かない。
 */
export const defaultSettings = (language: MeetingLanguage): Settings => ({
  storageDir: null,
  appearance: 'system',
  // 週 1 回。急ぐ知らせではなく、GitHub への問い合わせを必要以上に増やさない。
  updateCheck: 'weekly',
  memoryProtection: 'standard',
  recording: {
    silenceAlertEnabled: true,
    // 5 分。会議中の沈黙としては長く、止め忘れに気づくには十分早い。
    silenceDurationMs: 300_000,
    startAlertEnabled: true,
    // 1 分半。短い音声入力や着信の確認では届かず、会議の冒頭を取り逃さない長さ。
    startAlertDelayMs: 90_000,
    globalShortcutEnabled: true,
    calendarEnabled: false,
    autoStartEnabled: false
  },
  transcription: {
    provider: 'whisper-cpp',
    binaryPath: 'whisper-cli',
    modelPath: '',
    language,
    vadEnabled: true,
    vadModelPath: '',
    glossary: []
  },
  summarization: {
    provider: 'llama-cpp',
    modelPath: '',
    // 既定モデル（Gemma 4 E4B）は 128K まで扱えるが、KV キャッシュがメモリを
    // 食うため 32K に留める。16kHz 1 時間の会議でも分割せず 1 回で要約でき、
    // 分割による文脈の途切れを避けられる。
    contextSize: 32_768,
    promptTemplate: DEFAULT_SUMMARY_PROMPTS[language]
  },
  diarization: {
    enabled: true,
    maxSpeakers: 6,
    segmentationModelPath: '',
    embeddingModelPath: '',
    voiceprintThreshold: VOICEPRINT_MATCH_THRESHOLD,
    clusteringThreshold: DEFAULT_CLUSTERING_THRESHOLD
  },
  audio: {
    sampleRate: 16_000,
    codec: 'aac',
    bitrateKbps: 32
  },
  search: {
    // 600MB 超のモデル取得と全録音のベクトル化を、利用者の同意なしに始めない。
    enabled: false,
    modelPath: ''
  },
  chat: {
    enabled: true,
    // 8 件。32K のコンテキストで 1 件あたり数千字を割け、週次の問いはこれで足りる。
    // 増やすほど 1 件あたりが薄まり、どの会議の話か曖昧な答えになる。
    maxRecordings: 8
  }
})

export const isConfigured = (settings: Settings): boolean =>
  typeof settings.storageDir === 'string' && settings.storageDir.length > 0

/** undefined を無視してグループごとに浅くマージする。 */
const mergeGroup = <T extends object>(base: T, patch: Partial<T> | undefined): T => {
  if (!patch) return base
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
  return { ...base, ...defined } as T
}

export const mergeSettings = (base: Settings, patch: SettingsPatch): Settings => ({
  storageDir: patch.storageDir === undefined ? base.storageDir : patch.storageDir,
  appearance: patch.appearance === undefined ? base.appearance : patch.appearance,
  updateCheck: patch.updateCheck === undefined ? base.updateCheck : patch.updateCheck,
  memoryProtection:
    patch.memoryProtection === undefined ? base.memoryProtection : patch.memoryProtection,
  recording: mergeGroup(base.recording, patch.recording),
  transcription: mergeGroup(base.transcription, patch.transcription),
  summarization: mergeGroup(base.summarization, patch.summarization),
  diarization: mergeGroup(base.diarization, patch.diarization),
  audio: mergeGroup(base.audio, patch.audio),
  search: mergeGroup(base.search, patch.search),
  chat: mergeGroup(base.chat, patch.chat)
})

/** 保存前に呼ぶ。問題があれば、その種類を並べて返す（文言は表示側が引く）。 */
export const validateSettings = (settings: Settings): SettingsProblem[] => {
  const problems: SettingsProblem[] = []

  if (!SUPPORTED_SAMPLE_RATES.includes(settings.audio.sampleRate)) problems.push('sampleRate')
  if (settings.audio.bitrateKbps <= 0) problems.push('bitrate')
  if (settings.recording.silenceDurationMs < 60_000) problems.push('silenceDuration')
  if (settings.recording.startAlertDelayMs < 30_000) problems.push('startAlertDelay')
  if (settings.diarization.maxSpeakers < 2) problems.push('maxSpeakers')
  if (
    settings.diarization.voiceprintThreshold <= 0 ||
    settings.diarization.voiceprintThreshold > 1
  ) {
    problems.push('voiceprintThreshold')
  }
  if (
    settings.diarization.clusteringThreshold <= 0 ||
    settings.diarization.clusteringThreshold > 1
  ) {
    problems.push('clusteringThreshold')
  }
  if (!isAppearance(settings.appearance)) problems.push('appearance')
  if (!isUpdateCheckInterval(settings.updateCheck)) problems.push('updateCheck')
  if (!isMemoryProtection(settings.memoryProtection)) problems.push('memoryProtection')
  if (settings.summarization.contextSize < 1_024) problems.push('contextSize')
  if (!settings.summarization.promptTemplate.includes(TRANSCRIPT_PLACEHOLDER)) {
    problems.push('promptPlaceholder')
  }
  if (settings.chat.maxRecordings < 1 || settings.chat.maxRecordings > 30) {
    problems.push('chatMaxRecordings')
  }

  return problems
}
