import { MicSetupError, describeMicFailure, detailOf } from './micErrors'

/**
 * マイク音声を 16bit PCM にして main プロセスへ送る。
 *
 * システム音声は Core Audio Process Tap から main が直接受け取るが、マイクは
 * getUserMedia がレンダラー側の API なのでここで取る。AudioWorklet を使うのは、
 * 非推奨の ScriptProcessorNode と違いオーディオスレッドで動きメインスレッドの
 * 負荷に影響されないため（会議中に取りこぼすと音が飛ぶ）。
 */

/** ワークレットは別ファイルとして読み込む必要があるため、Blob URL で埋め込む。 */
const WORKLET_SOURCE = `
class MicTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel && channel.length > 0) {
      // Float32 [-1,1] を Int16 に変換して転送する（そのままだとバイト数が倍になる）
      const pcm = new Int16Array(channel.length)
      for (let i = 0; i < channel.length; i += 1) {
        const clamped = Math.max(-1, Math.min(1, channel[i]))
        pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer])
    }
    return true
  }
}
registerProcessor('mic-tap', MicTap)
`

export interface MicCapture {
  /** 停止して、マイクとオーディオコンテキストを解放する。 */
  stop(): Promise<void>
  /** 直近の入力レベル（0〜1）。レベルメーター表示用。 */
  level(): number
}

/**
 * マイクの取得を開始する。
 *
 * サンプルレートは録音全体と揃える必要がある。システム音声と別々のレートで
 * 録ると後段のミックスで整合しないため、AudioContext に明示的に指定する。
 */
export const startMicCapture = async (params: {
  sampleRate: number
  onPcm: (pcm: ArrayBuffer) => void
}): Promise<MicCapture> => {
  // 入力デバイスが 1 つも無い場合、getUserMedia のエラー名はブラウザ実装によって
  // 揺れる。先に列挙して判定した方が確実で、原因も正確に伝えられる。
  if (!(await hasAudioInput())) {
    throw describeMicFailure(namedError('NotFoundError'))
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        // 会議アプリ側でも処理されるため、二重に掛けて音質を落とさないようにする。
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })
  } catch (error: unknown) {
    throw describeMicFailure(error)
  }

  const context = new AudioContext({ sampleRate: params.sampleRate })
  const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }))

  try {
    await context.audioWorklet.addModule(workletUrl)
  } catch (error: unknown) {
    // CSP が blob: を塞いでいると、Chromium は理由を示さない AbortError
    // （"The user aborted a request."）だけを返す。権限やデバイスの問題と
    // 区別がつかないため、ここで何に失敗したかを明示する。
    await context.close()
    throw new MicSetupError(
      `マイクの音声処理を初期化できませんでした（${detailOf(error)}）。`,
      { cause: error }
    )
  } finally {
    URL.revokeObjectURL(workletUrl)
  }

  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'mic-tap')

  let peak = 0
  node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    peak = peakOf(new Int16Array(event.data))
    params.onPcm(event.data)
  }

  source.connect(node)
  // 出力に繋がないと処理が走らない実装があるため、無音のまま出力へ通す。
  const silence = context.createGain()
  silence.gain.value = 0
  node.connect(silence).connect(context.destination)

  return {
    level: () => peak,
    async stop(): Promise<void> {
      node.port.onmessage = null
      source.disconnect()
      node.disconnect()
      silence.disconnect()
      for (const track of stream.getTracks()) track.stop()
      await context.close()
    }
  }
}

/**
 * 入力デバイスが 1 つでもあるか。
 *
 * 権限を得る前の enumerateDevices はラベルを返さないが、デバイスの有無自体は
 * 分かる。列挙に失敗した場合は判定できないので「ある」とみなし、
 * getUserMedia 側の結果に委ねる。
 */
const hasAudioInput = async (): Promise<boolean> => {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.some((device) => device.kind === 'audioinput')
  } catch {
    return true
  }
}

const namedError = (name: string): Error => {
  const error = new Error(name)
  error.name = name
  return error
}

const peakOf = (samples: Int16Array): number => {
  let max = 0
  for (const sample of samples) {
    const magnitude = Math.abs(sample)
    if (magnitude > max) max = magnitude
  }
  return max / 32_768
}
