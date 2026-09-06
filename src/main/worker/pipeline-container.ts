import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DiarizationPort, ProgressReporterPort } from '@application/ports'
import { ProcessRecording } from '@application/usecases/ProcessRecording'
import { AfconvertEncoder } from '@infrastructure/audio/AfconvertEncoder'
import { TrackMixer } from '@infrastructure/audio/TrackMixer'
import { NullDiarizer, SherpaOnnxDiarizer } from '@infrastructure/diarization/SherpaOnnxDiarizer'
import {
  FileRecordingArtifactStore,
  FileRecordingRepository
} from '@infrastructure/persistence/FileRecordingStore'
import {
  JsonSettingsRepository,
  SettingsStorageLocator
} from '@infrastructure/settings/JsonSettingsRepository'
import { LlamaCppSummarizer } from '@infrastructure/summarization/LlamaCppSummarizer'
import { NodeLlamaSessionFactory } from '@infrastructure/summarization/NodeLlamaSessionFactory'
import { WhisperCppTranscriber } from '@infrastructure/transcription/WhisperCppTranscriber'
import { resolveWhisperBinary } from '@infrastructure/transcription/resolveWhisperBinary'
import type { DiarizationSettings } from '@domain/Settings'

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
    repository: new FileRecordingRepository(locator),
    artifacts: new FileRecordingArtifactStore(locator, join(userDataPath, 'work')),
    mixer: new TrackMixer(),
    encoder: new AfconvertEncoder(),
    transcriber: new WhisperCppTranscriber({
      binaryPath: resolveWhisperBinary({
        configured: current.transcription.binaryPath,
        ...(bundled === undefined ? {} : { bundled })
      }),
      modelPath: current.transcription.modelPath
    }),
    diarizer: createDiarizer(current.diarization),
    summarizer: new LlamaCppSummarizer(
      {
        modelPath: current.summarization.modelPath,
        contextSize: current.summarization.contextSize
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

/** モデルが揃っていなければ推論を試みず、2 話者分離のまま処理を通す。 */
const createDiarizer = (config: DiarizationSettings): DiarizationPort => {
  if (!config.enabled || !config.segmentationModelPath || !config.embeddingModelPath) {
    return new NullDiarizer()
  }

  return new SherpaOnnxDiarizer({
    segmentationModelPath: config.segmentationModelPath,
    embeddingModelPath: config.embeddingModelPath
  })
}
