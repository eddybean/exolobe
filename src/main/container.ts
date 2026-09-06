import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import { StartRecording } from '@application/usecases/StartRecording'
import { StopRecording } from '@application/usecases/StopRecording'
import {
  DeleteRecording,
  GetRecordingDetail,
  GetSetupState,
  ListRecordings,
  RenameRecording,
  RenameSpeaker,
  UpdateNote,
  UpdateSettings
} from '@application/usecases/library'
import { AudioTeeSource } from '@infrastructure/audio/AudioTeeSource'
import { DualTrackRecorder } from '@infrastructure/audio/DualTrackRecorder'
import {
  FileRecordingArtifactStore,
  FileRecordingRepository
} from '@infrastructure/persistence/FileRecordingStore'
import {
  JsonSettingsRepository,
  SettingsStorageLocator
} from '@infrastructure/settings/JsonSettingsRepository'

/**
 * 依存を結線する唯一の場所。
 *
 * ここから内側（usecases / domain）は Electron も whisper も llama.cpp も知らない。
 * 差し替えたい実装があればこのファイルだけを変える。
 */
export interface Container {
  readonly settings: JsonSettingsRepository
  readonly recorder: DualTrackRecorder
  readonly startRecording: StartRecording
  readonly stopRecording: StopRecording
  readonly listRecordings: ListRecordings
  readonly getRecordingDetail: GetRecordingDetail
  readonly updateNote: UpdateNote
  readonly renameRecording: RenameRecording
  readonly renameSpeaker: RenameSpeaker
  readonly deleteRecording: DeleteRecording
  readonly updateSettings: UpdateSettings
  readonly getSetupState: GetSetupState
}

export const createContainer = (): Container => {
  const userData = app.getPath('userData')
  const settings = new JsonSettingsRepository(join(userData, 'settings.json'))
  const locator = new SettingsStorageLocator(settings)

  const repository = new FileRecordingRepository(locator)
  const artifacts = new FileRecordingArtifactStore(locator, join(userData, 'work'))
  const recorder = new DualTrackRecorder(new AudioTeeSource())

  const library = { repository, artifacts }
  const capture = { repository, capture: recorder, artifacts }

  return {
    settings,
    recorder,
    startRecording: new StartRecording({
      settings,
      repository,
      capture: recorder,
      artifacts,
      clock: { now: () => new Date() },
      ids: { next: () => randomUUID() }
    }),
    stopRecording: new StopRecording(capture),
    listRecordings: new ListRecordings(library),
    getRecordingDetail: new GetRecordingDetail(library),
    updateNote: new UpdateNote(library),
    renameRecording: new RenameRecording(library),
    renameSpeaker: new RenameSpeaker(library),
    deleteRecording: new DeleteRecording(library),
    updateSettings: new UpdateSettings(settings),
    getSetupState: new GetSetupState(settings)
  }
}
