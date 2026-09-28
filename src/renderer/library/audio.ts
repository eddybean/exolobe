import type { RecordingDto } from '@shared/ipc'
import { libraryText } from '../i18n/library'

/**
 * 音声プレビューを再生できるか。
 *
 * 配布用の audio.m4a はパイプライン最後のエンコードで初めて生まれる。文字起こしは
 * それより先に終わるため、「文字は出ているのに再生だけできない」時間が実際にある。
 * UI はこの判定で再生手段を無効にし、押しても何も起きない状態を避ける。
 */
export const isAudioReady = (recording: RecordingDto): boolean =>
  recording.steps.encode?.status === 'done'

/** 再生できない間に添える理由。録音中に「処理を待て」と出すと、まだ何も始まっていないのに待たせることになる。 */
export const pendingAudioHint = (recordingStatus: string): string =>
  recordingStatus === 'recording'
    ? libraryText().audio.pendingRecording
    : libraryText().audio.pendingProcessing
