import { useCallback, useEffect, useRef, useState } from 'react'
import type { AutoStartedDto, SilenceAlertDto, StartAlertDto, TransportStateDto } from '@shared/ipc'
import { startMicCapture, type MicCapture } from '../audio/micCapture'
import { messageOf } from '../errorMessage'
import {
  LEVEL_HISTORY_CAPACITY,
  LEVEL_SAMPLE_INTERVAL_MS,
  mergeLevels,
  pushLevel,
  type LevelSample
} from '../session/levelHistory'
import { readTrackLevels } from '../session/readInputLevel'
import { startRecordingSession } from '../session/startRecordingSession'

export interface TrackLevels {
  readonly mic: number | undefined
  readonly system: number
}

const SILENT: TrackLevels = { mic: undefined, system: 0 }

export interface Transport {
  readonly state: TransportStateDto
  readonly elapsedMs: number
  /** 録音中の画面で 2 トラックを分けて出すためのレベル。マイクが取れていなければ mic は undefined。 */
  readonly levels: TrackLevels
  /**
   * 直近 10 秒ほどの入力レベル。波形は state を介さず自前のタイマーで読んで描く
   * （100ms ごとに React を再描画しないため）。
   */
  levelHistory(): readonly LevelSample[]
  readonly busy: boolean
  /** 録音を開始できなかった、あるいは停止に失敗した。 */
  readonly error: string | undefined
  /** 録音は続いているが、利用者に知らせるべきこと（マイクが取れなかった等）。 */
  readonly warning: string | undefined
  /** 無音が続いていることの知らせ。応答するまで出し続ける。 */
  readonly silenceAlert: SilenceAlertDto | undefined
  /** 無音の知らせに対して「続ける」を選ぶ。 */
  keepRecording(): void
  /** 会議が始まっていそうなのに録音していないことの知らせ。応答するまで出し続ける。 */
  readonly startAlert: StartAlertDto | undefined
  /** 録音を促す知らせに対して「今はしない」を選ぶ。 */
  skipRecording(): void
  /** 会議の予定を見て録音を自動で始めたことの知らせ（ADR-041）。録音中だけ出す。 */
  readonly autoStarted: AutoStartedDto | undefined
  /** 自動で始めた知らせに対して「続ける」を選ぶ。 */
  keepAutoStarted(): void
  start(title?: string): Promise<void>
  stop(): Promise<void>
  /** 録音を止め、何も残さずに消す（「停止して破棄」）。 */
  discard(): Promise<void>
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
  const [levels, setLevels] = useState<TrackLevels>(SILENT)
  const history = useRef<readonly LevelSample[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [warning, setWarning] = useState<string>()
  const [silenceAlert, setSilenceAlert] = useState<SilenceAlertDto>()
  const [startAlert, setStartAlert] = useState<StartAlertDto>()
  const [autoStarted, setAutoStarted] = useState<AutoStartedDto>()

  const mic = useRef<MicCapture | undefined>(undefined)

  useEffect(() => {
    void window.recorder.getTransportState().then(setState)
    return window.recorder.onTransportChanged(setState)
  }, [])

  useEffect(() => window.recorder.onSilenceAlert(setSilenceAlert), [])
  useEffect(() => window.recorder.onStartAlert(setStartAlert), [])
  useEffect(() => window.recorder.onAutoStarted(setAutoStarted), [])

  // 録音が終われば知らせる相手がいない。次の録音へ持ち越さない。
  useEffect(() => {
    if (!state.active) {
      setSilenceAlert(undefined)
      setAutoStarted(undefined)
    }
  }, [state.active])

  // 録音が始まれば促す理由が無くなる。バーを残さない。
  useEffect(() => {
    if (state.active) setStartAlert(undefined)
  }, [state.active])

  // 経過時間と入力レベルは録音中だけ更新する。
  useEffect(() => {
    if (!state.active || state.startedAtMs === undefined) {
      setElapsedMs(0)
      setLevels(SILENT)
      history.current = []
      return
    }

    const startedAtMs = state.startedAtMs
    let stopped = false
    // デスクトップ音声のレベル取得は IPC 越しなので、遅れたときに次々と
    // 積み増して順序が入れ替わらないよう、1 回ずつに限る。
    let reading = false

    // 波形のために 100ms で読むが、画面の数字とライブ画面のメーターは 200ms のまま。
    // メーターは間の読み出しも束ねて出す（システム音声の peak は読むたびに消えるため、
    // 捨てると音の到着周期しだいで常に 0 が表示される）。
    let tick = 0
    let reads = 0
    let pending: LevelSample | undefined

    const timer = window.setInterval(() => {
      tick += 1
      if (tick % 2 === 0) setElapsedMs(Date.now() - startedAtMs)
      if (reading) return

      reading = true
      void readTrackLevels({
        micLevel: mic.current?.level,
        systemLevel: window.recorder.getSystemAudioLevel
      }).then((next) => {
        reading = false
        // 取得は非同期なので、録音が終わった後の結果でメーターを戻さない。
        if (stopped) return
        history.current = pushLevel(history.current, next, LEVEL_HISTORY_CAPACITY)
        pending = pending === undefined ? next : mergeLevels(pending, next)
        reads += 1
        if (reads % 2 === 0) {
          setLevels(pending)
          pending = undefined
        }
      })
    }, LEVEL_SAMPLE_INTERVAL_MS)

    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [state.active, state.startedAtMs])

  const levelHistory = useCallback(() => history.current, [])

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

  /**
   * 「このまま続ける」。main 側の見張りをここから数え直させないと、
   * 無音のままなら次の判定が即座に来てしまう。
   */
  const keepRecording = useCallback((): void => {
    setSilenceAlert(undefined)
    void window.recorder.dismissSilenceAlert()
  }, [])

  /**
   * 「今はしない」。main 側の見張りを黙らせないと、会議の間ずっと
   * 同じ確認が出続けることになる。
   */
  const skipRecording = useCallback((): void => {
    setStartAlert(undefined)
    void window.recorder.dismissStartAlert()
  }, [])

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

  const discard = useCallback(async (): Promise<void> => {
    if (busy) return
    setBusy(true)

    try {
      await releaseMic()
      await window.recorder.discardRecording()
      setWarning(undefined)
    } catch (discardError: unknown) {
      setError(messageOf(discardError))
    } finally {
      setBusy(false)
    }
  }, [busy, releaseMic])

  // main から回ってきた開始・停止（メニュー・トレイ・通知・ショートカット）は、
  // マイクの取得・解放を含むこの手順で行う。main が直接始めると自分の声が録れない。
  // 購読し直さずに最新の start/stop を呼べるよう、参照を通す。
  const actions = useRef({ start, stop, discard })
  useEffect(() => {
    actions.current = { start, stop, discard }
  }, [start, stop, discard])

  useEffect(() => {
    const handle = (): void => {
      window.recorder
        .takeTransportRequest()
        .then((action) => {
          if (action === 'start') return actions.current.start()
          if (action === 'stop') return actions.current.stop()
          if (action === 'discard') return actions.current.discard()
          return undefined
        })
        .catch((requestError: unknown) => setError(messageOf(requestError)))
    }
    // ウィンドウが無い状態からの開始は、読み込みを終えた今ここで受け取る。
    handle()
    return window.recorder.onTransportRequested(handle)
  }, [])

  // アンマウント時にマイクを掴んだままにしない。
  useEffect(() => () => void releaseMic(), [releaseMic])

  return {
    state,
    elapsedMs,
    levels,
    levelHistory,
    busy,
    error,
    warning,
    silenceAlert,
    startAlert,
    autoStarted,
    keepAutoStarted: () => setAutoStarted(undefined),
    start,
    stop,
    discard,
    keepRecording,
    skipRecording,
    dismissError: () => setError(undefined)
  }
}

