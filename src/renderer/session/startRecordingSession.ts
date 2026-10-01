import type { MicCapture } from '../audio/micCapture'
import { messageOf } from '../errorMessage'
import { audioText } from '../i18n/audio'

/**
 * 録音開始時の方針を、React から切り離して表したもの。
 *
 * ここが決めているのは「マイクが取れなかったときに録音を捨てるかどうか」という
 * 一点で、UI の都合ではなく利用者にとっての損得の話なので、フックの中ではなく
 * 独立した関数として置きテストで固定している。
 */

/** この関数が必要とする main 側 API だけを写した型。 */
export interface RecorderApi {
  startRecording(title?: string): Promise<unknown>
  pushMicPcm(pcm: ArrayBuffer): void
}

export type StartMic = (params: { sampleRate: number; onPcm: (pcm: ArrayBuffer) => void }) => Promise<MicCapture>

export interface StartOutcome {
  /** 取得できたマイク。失敗した場合は undefined。 */
  readonly micCapture?: MicCapture
  /** 録音は続いているが、利用者に知らせるべきことがある場合のメッセージ。 */
  readonly warning?: string
}

/**
 * 録音を開始し、続けてマイクの取得を試みる。
 *
 * マイクの取得に失敗しても録音は止めない。デスクトップ音声さえ録れていれば
 * 会議相手の発言は残り、その録音には十分な価値があるため。自分の発言が
 * 入らないことは警告として伝え、続けるかどうかは利用者が決められるようにする。
 *
 * 逆に、録音そのものの開始に失敗した場合は何も録れていないので例外を投げる。
 */
export const startRecordingSession = async (params: {
  title?: string
  sampleRate: number
  api: RecorderApi
  startMic: StartMic
}): Promise<StartOutcome> => {
  await params.api.startRecording(params.title)

  try {
    const micCapture = await params.startMic({
      sampleRate: params.sampleRate,
      onPcm: (pcm) => params.api.pushMicPcm(pcm)
    })
    return { micCapture }
  } catch (micError: unknown) {
    return {
      warning: audioText().micFallbackWarning(messageOf(micError))
    }
  }
}
