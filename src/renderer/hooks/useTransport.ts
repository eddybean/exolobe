import { useCallback, useEffect, useRef, useState } from 'react'
import type { TransportStateDto } from '@shared/ipc'
import { startMicCapture, type MicCapture } from '../audio/micCapture'
import { messageOf } from '../errorMessage'
import { readInputLevel } from '../session/readInputLevel'
import { startRecordingSession } from '../session/startRecordingSession'

export interface Transport {
  readonly state: TransportStateDto
  readonly elapsedMs: number
  readonly level: number
  readonly busy: boolean
  /** 録音を開始できなかった、あるいは停止に失敗した。 */
  readonly error: string | undefined
  /** 録音は続いているが、利用者に知らせるべきこと（マイクが取れなかった等）。 */
  readonly warning: string | undefined
  start(title?: string): Promise<void>
  stop(): Promise<void>
  dismissError(): void
}

/**
 * 録音の開始・停止と、その最中の表示（経過時間・入力レベル）をまとめる。
 *
 * マイクの取得はレンダラー側の責務なのでここで行い、システム音声は main が
 * Core Audio Tap から直接受け取る。開始時の方針（マイクが取れなくても録音は
 * 続ける）は startRecordingSession に切り出してテストで固定している。
 */
export const useTransport = (sampleRate: number): Transport => {
  const [state, setState] = useState<TransportStateDto>({ active: false })
  const [elapsedMs, setElapsedMs] = useState(0)
  const [level, setLevel] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [warning, setWarning] = useState<string>()

  const mic = useRef<MicCapture | undefined>(undefined)

  useEffect(() => {
    void window.recorder.getTransportState().then(setState)
    return window.recorder.onTransportChanged(setState)
  }, [])

  // 経過時間と入力レベルは録音中だけ更新する。
  useEffect(() => {
    if (!state.active || state.startedAtMs === undefined) {
      setElapsedMs(0)
      setLevel(0)
      return
    }

    const startedAtMs = state.startedAtMs
    let stopped = false
    // デスクトップ音声のレベル取得は IPC 越しなので、遅れたときに次々と
    // 積み増して順序が入れ替わらないよう、1 回ずつに限る。
    let reading = false

    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtMs)
      if (reading) return

      reading = true
      void readInputLevel({
        micLevel: mic.current?.level,
        systemLevel: window.recorder.getSystemAudioLevel
      }).then((next) => {
        reading = false
        // 取得は非同期なので、録音が終わった後の結果でメーターを戻さない。
        if (!stopped) setLevel(next)
      })
    }, 200)

    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [state.active, state.startedAtMs])

  const releaseMic = useCallback(async (): Promise<void> => {
    const current = mic.current
    mic.current = undefined
    await current?.stop()
  }, [])

  const start = useCallback(
    async (title?: string): Promise<void> => {
      if (busy) return
      setBusy(true)
      setError(undefined)
      setWarning(undefined)

      try {
        const outcome = await startRecordingSession({
          ...(title === undefined ? {} : { title }),
          sampleRate,
          api: window.recorder,
          startMic: startMicCapture
        })

        mic.current = outcome.micCapture
        if (outcome.warning) setWarning(outcome.warning)
      } catch (startError: unknown) {
        setError(messageOf(startError))
      } finally {
        setBusy(false)
      }
    },
    [busy, sampleRate]
  )

  const stop = useCallback(async (): Promise<void> => {
    if (busy) return
    setBusy(true)

    try {
      await releaseMic()
      await window.recorder.stopRecording()
      setWarning(undefined)
    } catch (stopError: unknown) {
      setError(messageOf(stopError))
    } finally {
      setBusy(false)
    }
  }, [busy, releaseMic])

  // アンマウント時にマイクを掴んだままにしない。
  useEffect(() => () => void releaseMic(), [releaseMic])

  return {
    state,
    elapsedMs,
    level,
    busy,
    error,
    warning,
    start,
    stop,
    dismissError: () => setError(undefined)
  }
}

