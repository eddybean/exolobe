import { useCallback, useEffect, useRef, useState } from 'react'
import type { TransportStateDto } from '@shared/ipc'
import { startMicCapture, type MicCapture } from '../audio/micCapture'

export interface Transport {
  readonly state: TransportStateDto
  readonly elapsedMs: number
  readonly level: number
  readonly busy: boolean
  readonly error: string | undefined
  start(title?: string): Promise<void>
  stop(): Promise<void>
  dismissError(): void
}

/**
 * 録音の開始・停止と、その最中の表示（経過時間・入力レベル）をまとめる。
 *
 * マイクの取得はレンダラー側の責務なのでここで行い、システム音声は main が
 * Core Audio Tap から直接受け取る。開始は「main の録音開始 → マイク取得」の順で、
 * マイクが失敗したら録音自体を止めて中途半端な状態を残さない。
 */
export const useTransport = (sampleRate: number): Transport => {
  const [state, setState] = useState<TransportStateDto>({ active: false })
  const [elapsedMs, setElapsedMs] = useState(0)
  const [level, setLevel] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

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
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtMs)
      setLevel(mic.current?.level() ?? 0)
    }, 200)

    return () => window.clearInterval(timer)
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

      try {
        await window.recorder.startRecording(title)
        try {
          mic.current = await startMicCapture({
            sampleRate,
            onPcm: (pcm) => window.recorder.pushMicPcm(pcm)
          })
        } catch (micError: unknown) {
          // マイクだけ失敗した場合、自分の発話が残らない録音になってしまう。
          // 黙って続けず、いったん停止して利用者に判断させる。
          await window.recorder.stopRecording().catch(() => undefined)
          throw micError
        }
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
    start,
    stop,
    dismissError: () => setError(undefined)
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
