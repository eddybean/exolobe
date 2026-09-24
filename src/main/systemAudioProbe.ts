import { peakOf, type SystemAudioSource } from '@infrastructure/audio/DualTrackRecorder'

/**
 * システム音声を短い間だけ取り込み、届いた音の最大の大きさ（0〜1）を返す。
 * テスト録音で、アプリが鳴らした確認音が取れたかを見るために使う。
 *
 * 録音用（DualTrackRecorder）とは別の取り込みを使い、ファイルには何も書かない。
 * 終わったら成功でも失敗でも必ず止める。止め忘れると、次の録音の取り込みと取り合う。
 */
export const probeSystemAudio = async (params: {
  source: SystemAudioSource
  durationMs: number
  wait: (ms: number) => Promise<void>
  sampleRate?: number
}): Promise<number> => {
  let peak = 0
  let failure: Error | undefined
  params.source.onData((pcm) => {
    peak = Math.max(peak, peakOf(pcm))
  })
  params.source.onError((error) => {
    failure = error
  })

  try {
    await params.source.start({ sampleRate: params.sampleRate ?? 16_000 })
    await params.wait(params.durationMs)
  } finally {
    await params.source.stop()
  }

  if (failure) throw failure
  return peak
}
