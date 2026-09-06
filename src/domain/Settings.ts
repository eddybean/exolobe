/** audiotee が受け付けるサンプルレート。whisper は 16kHz を前提とするためこれが既定。 */
export const SUPPORTED_SAMPLE_RATES: readonly number[] = [
  8_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000
]

/** 要約プロンプト内で文字起こし本文に置き換えられるプレースホルダ。 */
export const TRANSCRIPT_PLACEHOLDER = '{{transcript}}'

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
  '---',
  TRANSCRIPT_PLACEHOLDER
].join('\n')

export interface TranscriptionSettings {
  /** 差し替え可能にするための識別子。将来クラウド実装を足す際の分岐キー。 */
  readonly provider: 'whisper-cpp'
  readonly binaryPath: string
  readonly modelPath: string
  /** whisper に渡す言語コード。`auto` で自動判定。 */
  readonly language: string
}

export interface SummarizationSettings {
  readonly provider: 'llama-cpp'
  readonly modelPath: string
  readonly contextSize: number
  readonly promptTemplate: string
}

export interface DiarizationSettings {
  readonly enabled: boolean
  readonly maxSpeakers: number
  readonly segmentationModelPath: string
  readonly embeddingModelPath: string
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

export interface Settings {
  /** ユーザーが初期設定で選ぶ保存先。未選択なら null。 */
  readonly storageDir: string | null
  readonly transcription: TranscriptionSettings
  readonly summarization: SummarizationSettings
  readonly diarization: DiarizationSettings
  readonly audio: AudioSettings
}

/**
 * グループ単位で部分更新できるようにした設定パッチ。
 * IPC や JSON 経由ではキーが存在したまま値だけ undefined になり得るため、
 * 各キーは明示的に undefined を許容する（mergeSettings が既存値を保つ）。
 */
export type SettingsPatch = {
  readonly storageDir?: string | null | undefined
  readonly transcription?: Partial<TranscriptionSettings>
  readonly summarization?: Partial<SummarizationSettings>
  readonly diarization?: Partial<DiarizationSettings>
  readonly audio?: Partial<AudioSettings>
}

export const defaultSettings = (): Settings => ({
  storageDir: null,
  transcription: {
    provider: 'whisper-cpp',
    binaryPath: 'whisper-cli',
    modelPath: '',
    language: 'ja'
  },
  summarization: {
    provider: 'llama-cpp',
    modelPath: '',
    contextSize: 8_192,
    promptTemplate: DEFAULT_SUMMARY_PROMPT
  },
  diarization: {
    enabled: true,
    maxSpeakers: 6,
    segmentationModelPath: '',
    embeddingModelPath: ''
  },
  audio: {
    sampleRate: 16_000,
    codec: 'aac',
    bitrateKbps: 32
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
  transcription: mergeGroup(base.transcription, patch.transcription),
  summarization: mergeGroup(base.summarization, patch.summarization),
  diarization: mergeGroup(base.diarization, patch.diarization),
  audio: mergeGroup(base.audio, patch.audio)
})

/** 保存前に呼ぶ。問題があればユーザー向けメッセージの配列を返す。 */
export const validateSettings = (settings: Settings): string[] => {
  const errors: string[] = []

  if (!SUPPORTED_SAMPLE_RATES.includes(settings.audio.sampleRate)) {
    errors.push(
      `サンプルレートは ${SUPPORTED_SAMPLE_RATES.join(', ')} のいずれかを指定してください。`
    )
  }
  if (settings.audio.bitrateKbps <= 0) {
    errors.push('ビットレートは 1kbps 以上を指定してください。')
  }
  if (settings.diarization.maxSpeakers < 2) {
    errors.push('話者数の上限は 2 以上を指定してください。')
  }
  if (settings.summarization.contextSize < 1_024) {
    errors.push('要約モデルのコンテキスト長は 1024 以上を指定してください。')
  }
  if (!settings.summarization.promptTemplate.includes(TRANSCRIPT_PLACEHOLDER)) {
    errors.push(
      `要約プロンプトには文字起こしの差し込み位置 ${TRANSCRIPT_PLACEHOLDER} を含めてください。`
    )
  }

  return errors
}
