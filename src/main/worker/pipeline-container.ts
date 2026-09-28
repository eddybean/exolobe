import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  DiarizationPort,
  ProgressReporterPort,
  SpeakerEmbeddingPort
} from '@application/ports'
import { ExtractVoices } from '@application/usecases/ExtractVoices'
import { ProcessRecording } from '@application/usecases/ProcessRecording'
import { AfconvertDecoder } from '@infrastructure/audio/AfconvertDecoder'
import { AfconvertEncoder } from '@infrastructure/audio/AfconvertEncoder'
import { TrackMixer } from '@infrastructure/audio/TrackMixer'
import { NullDiarizer, SherpaOnnxDiarizer } from '@infrastructure/diarization/SherpaOnnxDiarizer'
import { SherpaOnnxEmbeddingSessionFactory } from '@infrastructure/diarization/SherpaOnnxEmbeddingSessionFactory'
import { SherpaOnnxSessionFactory } from '@infrastructure/diarization/SherpaOnnxSessionFactory'
import {
  NullSpeakerEmbedder,
  SherpaOnnxSpeakerEmbedder
} from '@infrastructure/diarization/SherpaOnnxSpeakerEmbedder'
import {
  FileRecordingArtifactStore,
  FileRecordingRepository
} from '@infrastructure/persistence/FileRecordingStore'
import { FileVoiceprintRepository } from '@infrastructure/persistence/FileVoiceprintStore'
import {
  JsonSettingsRepository,
  SettingsStorageLocator
} from '@infrastructure/settings/JsonSettingsRepository'
import {
  AppleLmSessionFactory,
  appleIntelligenceStatus
} from '@infrastructure/summarization/AppleLmSessionFactory'
import { LlamaCppSummarizer } from '@infrastructure/summarization/LlamaCppSummarizer'
import { NodeLlamaSessionFactory } from '@infrastructure/summarization/NodeLlamaSessionFactory'
import { resolveAppleLmBinary } from '@infrastructure/summarization/resolveAppleLmBinary'
import { NodeSystemResourceProbe } from '@infrastructure/system/NodeSystemResourceProbe'
import {
  WhisperCppTranscriber,
  droppedSegmentLogger
} from '@infrastructure/transcription/WhisperCppTranscriber'
import { resolveWhisperBinary } from '@infrastructure/transcription/resolveWhisperBinary'
import {
  summarizationProviderOf,
  type DiarizationSettings,
  type Settings,
  type TranscriptionSettings
} from '@domain/Settings'
import type { Locale } from '@shared/i18n/locale'

/**
 * パイプライン用の依存を組み立てる。
 *
 * `electron` を import しないのが要点。この関数は utilityProcess（Node のみで
 * electron API が無い環境）から呼ばれるため、必要なパスは引数で受け取る。
 */
export const createPipeline = async (
  userDataPath: string,
  uiLocale: Locale,
  progress: ProgressReporterPort
): Promise<ProcessRecording> => {
  const settings = new JsonSettingsRepository(join(userDataPath, 'settings.json'), uiLocale)
  const locator = new SettingsStorageLocator(settings)
  const current = await settings.load()
  const bundled = bundledWhisper()
  // stdio: 'inherit' で fork されるため、書いた行はそのまま開発時の端末へ出る。
  const dropped = droppedSegmentLogger(process.env, (line) => console.warn(line))

  return new ProcessRecording({
    settings,
    fallbackLanguage: uiLocale,
    progress,
    system: new NodeSystemResourceProbe(),
    repository: new FileRecordingRepository(locator),
    artifacts: new FileRecordingArtifactStore(locator, join(userDataPath, 'work')),
    mixer: new TrackMixer(),
    encoder: new AfconvertEncoder(),
    transcriber: new WhisperCppTranscriber({
      binaryPath: resolveWhisperBinary({
        configured: current.transcription.binaryPath,
        ...(bundled === undefined ? {} : { bundled })
      }),
      modelPath: current.transcription.modelPath,
      vadModelPath: resolveVadModel(current.transcription),
      glossary: current.transcription.glossary,
      // 閾値を見直すための計測モード。既定では undefined が入り、何も記録しない。
      ...(dropped === undefined ? {} : { onDropped: dropped })
    }),
    diarizer: createDiarizer(current.diarization),
    embedder: createEmbedder(current.diarization),
    voiceprints: new FileVoiceprintRepository(locator),
    summarizer: await createSummarizer(current)
  })
}

/**
 * 声紋の取り直し用の依存を組み立てる。
 *
 * パイプラインと同じワーカーで動くが、要るのは埋め込みモデルとデコーダだけ。
 * whisper も LLM も読まない ―― 名前を付けるたびに 5GB を読み込んでいては使えない。
 */
export const createVoiceExtractor = async (
  userDataPath: string,
  uiLocale: Locale
): Promise<ExtractVoices> => {
  const settings = new JsonSettingsRepository(join(userDataPath, 'settings.json'), uiLocale)
  const locator = new SettingsStorageLocator(settings)
  const current = await settings.load()

  return new ExtractVoices({
    repository: new FileRecordingRepository(locator),
    artifacts: new FileRecordingArtifactStore(locator, join(userDataPath, 'work')),
    embedder: createEmbedder(current.diarization),
    decoder: new AfconvertDecoder()
  })
}

/**
 * 設定で選んだモデルで要約する（ADR-046）。どちらも分割・統合は LlamaCppSummarizer が担い、
 * 応答の入れ物だけが違う。
 */
const createSummarizer = async (current: Settings): Promise<LlamaCppSummarizer> => {
  if (summarizationProviderOf(current) === 'llama-cpp') {
    return new LlamaCppSummarizer(
      {
        modelPath: current.summarization.modelPath,
        contextSize: current.summarization.contextSize,
        protection: current.memoryProtection
      },
      new NodeLlamaSessionFactory()
    )
  }

  const resourcesPath = process.env['OMR_RESOURCES']
  const binaryPath = resolveAppleLmBinary({
    packaged: resourcesPath !== undefined,
    resourcesPath: resourcesPath ?? ''
  })
  // コンテキスト長はモデルに聞く（設定の contextSize は Gemma 用）。使えなければ最初の応答が
  // 理由つきで失敗するので、分割の大きさは macOS 27 の値で仮に決めておけば足りる。
  const status = await appleIntelligenceStatus(binaryPath)
  return new LlamaCppSummarizer(
    {
      // modelPath は node-llama-cpp 用。空だと「モデル未設定」で止まるので、名前だけ入れる。
      modelPath: 'apple-intelligence',
      contextSize: status.contextSize ?? APPLE_INTELLIGENCE_CONTEXT_SIZE,
      protection: current.memoryProtection
    },
    new AppleLmSessionFactory(binaryPath)
  )
}

/** macOS 27 の Apple Intelligence のコンテキスト長。applelm が答えられないときの仮の値。 */
const APPLE_INTELLIGENCE_CONTEXT_SIZE = 8_192

/**
 * パッケージ済みアプリに同梱した whisper-cli。
 * 開発中は存在しないので undefined を返し、PATH 上の whisper-cli にフォールバックする。
 */
const bundledWhisper = (): string | undefined => {
  const resourcesPath = process.env['OMR_RESOURCES']
  if (!resourcesPath) return undefined

  const path = join(resourcesPath, 'bin', 'whisper-cli')
  return existsSync(path) ? path : undefined
}

/**
 * 無音区間の除外に使う VAD モデル。
 *
 * 設定で無効にされているか、モデルが未取得・削除済みなら空文字を返す。
 * その場合 whisper は音声全体を読むだけで、文字起こし自体は従来どおり動く。
 */
const resolveVadModel = (config: TranscriptionSettings): string => {
  if (!config.vadEnabled || !config.vadModelPath) return ''
  return existsSync(config.vadModelPath) ? config.vadModelPath : ''
}

/**
 * 声紋の抽出。話者識別と同じ埋め込みモデルを読む（ADR-031）。
 * 分割が動かない設定なら声紋を取る相手もいないので、同じ条件で無効にする。
 */
const createEmbedder = (config: DiarizationSettings): SpeakerEmbeddingPort => {
  if (!config.enabled || !config.segmentationModelPath || !config.embeddingModelPath) {
    return new NullSpeakerEmbedder()
  }

  return new SherpaOnnxSpeakerEmbedder(
    { embeddingModelPath: config.embeddingModelPath },
    new SherpaOnnxEmbeddingSessionFactory()
  )
}

/** モデルが揃っていなければ推論を試みず、2 話者分離のまま処理を通す。 */
const createDiarizer = (config: DiarizationSettings): DiarizationPort => {
  if (!config.enabled || !config.segmentationModelPath || !config.embeddingModelPath) {
    return new NullDiarizer()
  }

  return new SherpaOnnxDiarizer(
    {
      segmentationModelPath: config.segmentationModelPath,
      embeddingModelPath: config.embeddingModelPath,
      clusteringThreshold: config.clusteringThreshold
    },
    new SherpaOnnxSessionFactory()
  )
}
