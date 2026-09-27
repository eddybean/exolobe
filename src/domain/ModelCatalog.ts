import type { SettingsPatch } from './Settings'

/**
 * アプリが自分でダウンロードして管理するファイルの一覧。
 *
 * 配布版を使う利用者に Homebrew も手動ダウンロードも求めないための仕組み。
 * URL・サイズ・チェックサムはここに集約し、差し替えはこのファイルだけで済むようにする。
 *
 * Hugging Face の URL は resolve/main ではなくコミットで固定する。上流がファイルを
 * 差し替えるとチェックサムが合わなくなり、新しく入れる利用者のダウンロードが失敗するため。
 * モデルを更新するときは評価で前後を比べてから、コミットと sha256 を一緒に書き換える。
 */

export type ManagedAssetId =
  | 'transcription-model'
  | 'transcription-coreml-encoder'
  | 'vad-model'
  | 'summarization-model'
  | 'diarization-segmentation'
  | 'diarization-embedding'
  | 'search-model'

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
  readonly archive?: 'tar.bz2' | 'zip'
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
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin',
    fileName: 'ggml-large-v3-turbo-q5_0.bin',
    bytes: 574_041_195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    optional: false,
    applyTo: (path) => ({ transcription: { modelPath: path } })
  },
  /**
   * Core ML エンコーダを任意にしている理由:
   * whisper.cpp は WHISPER_COREML_ALLOW_FALLBACK 付きでビルドしてあるため、
   * これが無ければ従来どおり Metal だけで動く（文字起こしは成立する）。
   * 一方で 1.2GB とモデル本体より大きく、必須にすると初回ダウンロードが
   * 5.7GB から 6.9GB へ増える。速度を取るかディスクを取るかは利用者に選ばせる。
   *
   * 保存名は変えてはいけない。whisper.cpp はモデルのパスから拡張子と
   * '-q5_0' を落として '-encoder.mlmodelc' を足したパスを探すため、
   * ggml-large-v3-turbo-q5_0.bin の隣のこの名前でしか見つけられない。
   */
  {
    id: 'transcription-coreml-encoder',
    label: '文字起こし高速化（任意）',
    description:
      'whisper のエンコーダを Neural Engine で動かします。文字起こしが約 1.4 倍速くなります（メモリ使用量は変わりません）。',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-encoder.mlmodelc.zip',
    fileName: 'ggml-large-v3-turbo-encoder.mlmodelc.zip',
    bytes: 1_173_393_014,
    sha256: '84bedfe895bd7b5de6e8e89a0803dfc5addf8c0c5bc4c937451716bf7cf7988a',
    archive: 'zip',
    entryPath: 'ggml-large-v3-turbo-encoder.mlmodelc/weights/weight.bin',
    optional: true,
    // whisper.cpp がモデルのパスから位置を導くので、設定に書く項目が無い。
    applyTo: () => ({})
  },
  {
    id: 'vad-model',
    label: '無音検出モデル',
    description:
      'Silero VAD。喋っていない区間を文字起こしから除き、無音から生まれる誤った文章を防ぎます。',
    url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v5.1.2.bin',
    fileName: 'ggml-silero-v5.1.2.bin',
    bytes: 885_098,
    sha256: '29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf',
    // 1MB 未満と極小で、文字起こしの品質に直結するため任意扱いにしない。
    // 未取得でも VAD 無しで文字起こしは動くので、録音を妨げることはない。
    optional: false,
    applyTo: (path) => ({ transcription: { vadModelPath: path } })
  },
  {
    id: 'summarization-model',
    label: '要約モデル',
    description:
      'Gemma 4 E4B（QAT q4_0）。128K のコンテキストがあり、長い会議も分割せず要約できます。',
    url: 'https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/resolve/4b4a2c1d584be7264f87aac328a1bc739ce81b6c/gemma-4-E4B_q4_0-it.gguf',
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
    bytes: 6_958_444,
    sha256: '24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488',
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
    bytes: 28_281_164,
    sha256: 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2',
    optional: true,
    applyTo: (path) => ({ diarization: { embeddingModelPath: path } })
  },
  /**
   * 意味検索に bge-m3 を選んでいる理由:
   * 日本語を含む多言語で強く、クエリに指示文の前置きが要らない（自然文をそのまま渡せる）。
   * 同系の multilingual-e5-small は 130MB と軽いが、会議の言い換え表現で取りこぼしが増える。
   * 配布元は VAD と同じ ggml-org（llama.cpp の公式変換）。MIT ライセンス。
   */
  {
    id: 'search-model',
    label: '意味検索モデル（任意）',
    description:
      'bge-m3（Q8_0）。「天気の話をした会議」のような自然な文章で録音を探せるようにします。',
    url: 'https://huggingface.co/ggml-org/bge-m3-Q8_0-GGUF/resolve/9eba04c5d75ba5a1595e45de734d36bef4e5cb98/bge-m3-q8_0.gguf',
    fileName: 'bge-m3-q8_0.gguf',
    bytes: 634_553_760,
    sha256: 'aa473d51f451a22f0fcf39ba3330c14bed38a385712b1113440f69df4047a173',
    optional: true,
    applyTo: (path) => ({ search: { modelPath: path } })
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
