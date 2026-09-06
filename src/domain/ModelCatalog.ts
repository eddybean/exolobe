import type { SettingsPatch } from './Settings'

/**
 * アプリが自分でダウンロードして管理するファイルの一覧。
 *
 * 配布版を使う利用者に Homebrew も手動ダウンロードも求めないための仕組み。
 * URL・サイズ・チェックサムはここに集約し、差し替えはこのファイルだけで済むようにする。
 */

export type ManagedAssetId =
  | 'transcription-model'
  | 'summarization-model'
  | 'diarization-segmentation'
  | 'diarization-embedding'

export interface ManagedAsset {
  readonly id: ManagedAssetId
  readonly label: string
  readonly description: string
  readonly url: string
  /** models ディレクトリ配下の保存名。 */
  readonly fileName: string
  readonly bytes: number
  readonly sha256?: string
  /** 圧縮されて配布されているものは展開が要る。 */
  readonly archive?: 'tar.bz2'
  /** 展開後に実際に使うファイル（アーカイブ内の相対パス）。 */
  readonly entryPath?: string
  /** 無くても録音・文字起こし・要約は動くか。 */
  readonly optional: boolean
  /** 取得できたパスを設定のどこに書き込むか。 */
  applyTo(path: string): SettingsPatch
}

/**
 * 要約に Gemma 4 E4B を既定にしている理由:
 * コンテキストが 128K あり、1 時間規模の会議でも分割せず一度に要約できる。
 * 分割要約は部分ごとに文脈が切れて決定事項を取りこぼしやすいため、
 * 一度に読ませられることが要約品質に直結する。日本語の扱いも強い。
 * QAT（量子化を考慮した学習）版を選び、q4 での劣化を抑えている。
 */
export const MANAGED_ASSETS: readonly ManagedAsset[] = [
  {
    id: 'transcription-model',
    label: '文字起こしモデル',
    description: 'whisper large-v3-turbo（q5_0）。日本語を含む多言語に対応します。',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    fileName: 'ggml-large-v3-turbo-q5_0.bin',
    bytes: 574_041_195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    optional: false,
    applyTo: (path) => ({ transcription: { modelPath: path } })
  },
  {
    id: 'summarization-model',
    label: '要約モデル',
    description:
      'Gemma 4 E4B（QAT q4_0）。128K のコンテキストがあり、長い会議も分割せず要約できます。',
    url: 'https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/resolve/main/gemma-4-E4B_q4_0-it.gguf',
    fileName: 'gemma-4-E4B_q4_0-it.gguf',
    bytes: 5_154_941_280,
    sha256: '676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee',
    optional: false,
    applyTo: (path) => ({ summarization: { modelPath: path } })
  },
  {
    id: 'diarization-segmentation',
    label: '話者分割モデル（任意）',
    description: '参加者が複数人いるとき、相手側を話者ごとに分けるために使います。',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2',
    fileName: 'sherpa-onnx-pyannote-segmentation-3-0.tar.bz2',
    bytes: 7_000_000,
    archive: 'tar.bz2',
    entryPath: 'sherpa-onnx-pyannote-segmentation-3-0/model.onnx',
    optional: true,
    applyTo: (path) => ({ diarization: { segmentationModelPath: path } })
  },
  {
    id: 'diarization-embedding',
    label: '話者埋め込みモデル（任意）',
    description: '話者分割モデルと組み合わせて、同じ人の発話をまとめます。',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
    fileName: '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
    bytes: 28_300_000,
    optional: true,
    applyTo: (path) => ({ diarization: { embeddingModelPath: path } })
  }
]

export const findAsset = (id: string): ManagedAsset | undefined =>
  MANAGED_ASSETS.find((asset) => asset.id === id)

/** 録音を文字起こし・要約まで通すのに欠かせないもの。 */
export const requiredAssets = (): ManagedAsset[] =>
  MANAGED_ASSETS.filter((asset) => !asset.optional)

/** 表示用のサイズ。ダウンロード前に利用者が判断できるようにする。 */
export const formatBytes = (bytes: number): string => {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)}GB`
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)}MB`
  return `${Math.round(bytes / 1_000)}KB`
}
