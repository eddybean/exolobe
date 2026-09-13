import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  DiarizationPort,
  ProgressReporterPort,
  SpeakerEmbeddingPort
} from '@application/ports'
import { ProcessRecording } from '@application/usecases/ProcessRecording'
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
import { LlamaCppSummarizer } from '@infrastructure/summarization/LlamaCppSummarizer'
import { NodeLlamaSessionFactory } from '@infrastructure/summarization/NodeLlamaSessionFactory'
import { NodeSystemResourceProbe } from '@infrastructure/system/NodeSystemResourceProbe'
import { WhisperCppTranscriber } from '@infrastructure/transcription/WhisperCppTranscriber'
import { resolveWhisperBinary } from '@infrastructure/transcription/resolveWhisperBinary'
import type { DiarizationSettings, TranscriptionSettings } from '@domain/Settings'

/**
 * パイプライン用の依存を組み立てる。
 *
 * `electron` を import しないのが要点。この関数は utilityProcess（Node のみで
 * electron API が無い環境）から呼ばれるため、必要なパスは引数で受け取る。
 */
export const createPipeline = async (
  userDataPath: string,
  progress: ProgressReporterPort
): Promise<ProcessRecording> => {
  const settings = new JsonSettingsRepository(join(userDataPath, 'settings.json'))
  const locator = new SettingsStorageLocator(settings)
  const current = await settings.load()
  const bundled = bundledWhisper()

  return new ProcessRecording({
    settings,
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
      vadModelPath: resolveVadModel(current.transcription)
    }),
    diarizer: createDiarizer(current.diarization),
    embedder: createEmbedder(current.diarization),
    voiceprints: new FileVoiceprintRepository(locator),
    summarizer: new LlamaCppSummarizer(
      {
        modelPath: current.summarization.modelPath,
        contextSize: current.summarization.contextSize,
        protection: current.memoryProtection
      },
      new NodeLlamaSessionFactory()
    )
  })
}

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
      embeddingModelPath: config.embeddingModelPath
    },
    new SherpaOnnxSessionFactory()
  )
}
