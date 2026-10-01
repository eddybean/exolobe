import type { ManagedAssetId } from '@domain/ModelCatalog'
import type { Locale } from './locale'

/** 画面に名前を出すモデル。ファイル単位の資産と、話者識別の 2 ファイルをまとめたパッケージ。 */
export type ModelTextId = ManagedAssetId | 'diarization'

interface ModelText {
  readonly label: string
  readonly description: string
}

type ModelTexts = Readonly<Record<ModelTextId, ModelText>>

const ja: ModelTexts = {
  'transcription-model': {
    label: '文字起こしモデル',
    description: 'whisper large-v3-turbo（q5_0）。日本語を含む多言語に対応します。'
  },
  'transcription-coreml-encoder': {
    label: '文字起こし高速化（任意）',
    description:
      'whisper のエンコーダを Neural Engine で動かします。文字起こしが約 1.4 倍速くなります（メモリ使用量は変わりません）。'
  },
  'vad-model': {
    label: '無音検出モデル',
    description: 'Silero VAD。喋っていない区間を文字起こしから除き、無音から生まれる誤った文章を防ぎます。'
  },
  'summarization-model': {
    label: '要約モデル',
    description: 'Gemma 4 E4B（QAT q4_0）。128K のコンテキストがあり、長い会議も分割せず要約できます。'
  },
  'diarization-segmentation': {
    label: '話者分割モデル（任意）',
    description: '参加者が複数人いるとき、相手側を話者ごとに分けるために使います。'
  },
  'diarization-embedding': {
    label: '話者埋め込みモデル（任意）',
    description: '話者分割モデルと組み合わせて、同じ人の発話をまとめます。'
  },
  'search-model': {
    label: '意味検索モデル（任意）',
    description: 'bge-m3（Q8_0）。「天気の話をした会議」のような自然な文章で録音を探せるようにします。'
  },
  diarization: {
    label: '話者識別モデル（任意）',
    description:
      '参加者が複数人いるとき、相手側を話者ごとに分けます。話者分割と話者埋め込みの 2 つのファイルをまとめて取得します。'
  }
}

const en: ModelTexts = {
  'transcription-model': {
    label: 'Transcription model',
    description: 'whisper large-v3-turbo (q5_0). Supports many languages, including Japanese.'
  },
  'transcription-coreml-encoder': {
    label: 'Transcription acceleration (optional)',
    description:
      'Runs the whisper encoder on the Neural Engine. Transcription gets about 1.4× faster (memory use is unchanged).'
  },
  'vad-model': {
    label: 'Voice activity detection model',
    description:
      'Silero VAD. Removes silent stretches before transcription so silence does not turn into made-up sentences.'
  },
  'summarization-model': {
    label: 'Summarization model',
    description: 'Gemma 4 E4B (QAT q4_0). Its 128K context lets it summarize long meetings without splitting them.'
  },
  'diarization-segmentation': {
    label: 'Speaker segmentation model (optional)',
    description: 'Separates the other side into individual speakers when several people take part.'
  },
  'diarization-embedding': {
    label: 'Speaker embedding model (optional)',
    description: 'Works with the segmentation model to group speech from the same person.'
  },
  'search-model': {
    label: 'Semantic search model (optional)',
    description:
      'bge-m3 (Q8_0). Lets you find recordings with natural phrases like “the meeting where we talked about the weather”.'
  },
  diarization: {
    label: 'Speaker identification model (optional)',
    description:
      'Separates the other side into individual speakers when several people take part. Downloads the segmentation and embedding files together.'
  }
}

const TEXTS: Readonly<Record<Locale, ModelTexts>> = { ja, en }

const isModelTextId = (id: string): id is ModelTextId => id in ja

/** モデルの名前と説明。カタログに無い ID（古い版の installed.json など）は ID をそのまま名前にする。 */
export const modelText = (id: string, locale: Locale): ModelText =>
  isModelTextId(id) ? TEXTS[locale][id] : { label: id, description: '' }
