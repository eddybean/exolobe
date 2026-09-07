import type { RecordingDto } from '@shared/ipc'

/**
 * 音声プレビューを再生できるか。
 *
 * 配布用の audio.m4a はパイプライン最後のエンコードで初めて生まれる。文字起こしは
 * それより先に終わるため、「文字は出ているのに再生だけできない」時間が実際にある。
 * UI はこの判定で再生手段を無効にし、押しても何も起きない状態を避ける。
 */
export const isAudioReady = (recording: RecordingDto): boolean =>
  recording.steps.encode?.status === 'done'
