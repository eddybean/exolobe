import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { PIPELINE_STEPS, transcriptEditBlocker, type PipelineStep } from '@domain/Recording'
import type { RecordingDetailDto } from '@shared/ipc'
import { STEP_LABELS, formatDateTime, formatDuration } from '../format'
import { CopyButton } from '../components/CopyButton'
import { Markdown } from '../components/Markdown'
import { EditableTitle } from '../components/EditableTitle'
import { EditableSpeaker } from '../components/EditableSpeaker'
import { EditableSegmentText } from '../components/EditableSegmentText'
import { PlayerControls } from '../components/PlayerControls'
import { SpeakerTimeline } from '../components/SpeakerTimeline'
import { useAudioPosition } from '../hooks/useAudioPosition'
import { isAudioReady, pendingAudioHint } from '../library/audio'
import {
  activeSegmentIndex,
  followScrollTop,
  speakerLanes,
  speakerTones,
  timelineDurationMs
} from '../library/timeline'
import { focusedSegmentIndex } from '../library/transcriptSearch'
import { isPlaybackToggleKey, nextPlaybackRate, playerMode } from '../library/playback'
import { voiceLearnedNotice } from '../library/voiceLearning'
import { resummarizeState, type ResummarizeState } from '../resummarize'
import { failureTooltip, failuresIn, type StepFailure } from '../stepFailure'
import {
  applyProgressEvent,
  estimateRemainingMs,
  pipelinePillLabel,
  showsPipelineProgress,
  type ProgressSamples
} from '../pipelineProgress'

/** メモの自動保存までの待ち時間。打鍵のたびに書かないため。 */
const NOTE_SAVE_DELAY_MS = 600

type Tab = 'summary' | 'note'

/** 再要約ボタンのツールチップ。押せないときは、その理由をその場で読めるようにする。 */
const RESUMMARIZE_HINT: Readonly<Record<ResummarizeState, string>> = {
  ready: '話者名や本文を直したあとなど、要約を作り直す',
  summarizing: '要約を作り直しています',
  busy: '他の処理が終わると要約し直せます',
  unavailable: '文字起こしができると要約し直せます'
}

/**
 * 詳細画面。上に全幅の再生と話者ごとの発言の帯、下の左に話者付き文字起こし、右に要約とメモを置く。
 * 再生中は今の発言を文字起こしの中で強調し、見える位置へ送る。
 * 処理中はタイトル下のピルで進み具合を出す。要約・文字起こしはそれぞれコピーでき、メモは編集して自動保存される。
 */
export const RecordingDetailView = ({
  detail,
  focus,
  onChanged,
  onDelete
}: {
  detail: RecordingDetailDto
  /** 本文の検索から飛んできた発言。nonce が変わるたびに飛び直す。 */
  focus?: { startMs: number; nonce: number } | undefined
  onChanged: () => void
  onDelete: () => void
}): ReactElement => {
  const [tab, setTab] = useState<Tab>('summary')
  const [note, setNote] = useState(detail.note)
  const [noteSaved, setNoteSaved] = useState(true)
  const [error, setError] = useState<string>()
  const [voiceNotice, setVoiceNotice] = useState<string>()
  const audioRef = useRef<HTMLAudioElement>(null)

  const recordingId = detail.recording.id
  // エンコードが終わるまで音声ファイルは無い。再生手段はまとめて無効にする。
  const audioReady = isAudioReady(detail.recording)

  // 別の録音に切り替わったら編集中の内容を持ち越さない。
  useEffect(() => {
    setNote(detail.note)
    setNoteSaved(true)
  }, [recordingId, detail.note])

  // 声紋の登録は名前の反映より遅れて終わる。結果は後から届く。
  useEffect(() => {
    setVoiceNotice(undefined)
    return window.recorder.onVoiceLearned((event) => {
      if (event.recordingId !== recordingId) return
      setVoiceNotice(voiceLearnedNotice(event))
    })
  }, [recordingId])

  // 入力が止まってから保存する。
  useEffect(() => {
    if (note === detail.note) return

    setNoteSaved(false)
    const timer = window.setTimeout(() => {
      window.recorder
        .updateNote(recordingId, note)
        .then(() => setNoteSaved(true))
        .catch((saveError: unknown) => setError(messageOf(saveError)))
    }, NOTE_SAVE_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [note, detail.note, recordingId])

  const labels = useMemo(
    () => new Map(detail.speakers.map((speaker) => [speaker.id, speaker.label])),
    [detail.speakers]
  )

  // 帯と話者名で同じ色を使う。どちらも同じ番号表を引く。
  const tones = useMemo(() => speakerTones(detail.speakers), [detail.speakers])
  const lanes = useMemo(
    () => speakerLanes(detail.segments, detail.speakers),
    [detail.segments, detail.speakers]
  )
  const timelineMs = timelineDurationMs(detail.recording.durationMs, detail.segments)

  const { positionMs, playing, durationMs: audioMs } = useAudioPosition(audioRef, recordingId)
  const player = playerMode(detail.segments.length)
  // 一度も再生していない頭出しの位置では強調しない。開いただけで先頭の発言が光るのは紛らわしい。
  const playingIndex =
    audioReady && (playing || positionMs > 0) ? activeSegmentIndex(detail.segments, positionMs) : -1
  const segmentsRef = useRef<HTMLOListElement>(null)

  /**
   * 再生中は今の発言を見える位置へ送る。止めている間は送らない（読み返している位置を奪わない）。
   * 本文や話者名を直している最中も送らない — 編集欄が視界から消える。
   */
  useEffect(() => {
    const list = segmentsRef.current
    if (!playing || playingIndex < 0 || !list) return
    if (list.contains(document.activeElement) && document.activeElement?.tagName !== 'BUTTON') return

    const item = list.children[playingIndex]
    if (!(item instanceof HTMLElement)) return
    const top = followScrollTop({
      scrollTop: list.scrollTop,
      viewHeight: list.clientHeight,
      itemTop: item.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop,
      itemHeight: item.offsetHeight
    })
    if (top !== undefined) list.scrollTo({ top, behavior: 'smooth' })
  }, [playing, playingIndex])

  const resummarize = useMemo(
    () => resummarizeState(detail.recording.steps, detail.segments.length > 0),
    [detail.recording.steps, detail.segments.length]
  )

  // 速度は録音を切り替えても持ち越す。速めて聞く人は、どの録音でも速めて聞く。
  // defaultPlaybackRate にも入れるのは、src が変わると playbackRate がそこへ戻されるため。
  const [rate, setRate] = useState(1)
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.defaultPlaybackRate = rate
    audio.playbackRate = rate
  }, [rate, recordingId])

  const togglePlayback = useCallback((): void => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play()
    else audio.pause()
  }, [])

  // Space で再生・停止する。独自の操作のときだけ — 標準のプレーヤーは自分で Space を扱う。
  useEffect(() => {
    if (player !== 'custom' || !audioReady) return
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : undefined
      const toggles = isPlaybackToggleKey({
        key: event.key,
        repeat: event.repeat,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        isComposing: event.isComposing,
        targetTag: target?.tagName ?? '',
        targetEditable: target?.isContentEditable ?? false,
        modalOpen: document.querySelector('[aria-modal="true"]') !== null
      })
      if (!toggles || event.defaultPrevented) return
      // 既定の動き（ページのスクロール）を止める。
      event.preventDefault()
      togglePlayback()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [player, audioReady, togglePlayback])

  const seek = useCallback((ms: number): void => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = ms / 1000
    void audio.play()
  }, [])

  /**
   * 本文の検索から飛んできた発言。ここでは印を付けてスクロールするだけで、
   * 再生までは始めない（探している最中に音が鳴り出すのは求められていない）。
   */
  const focusedIndex = focus === undefined ? -1 : focusedSegmentIndex(detail.segments, focus.startMs)
  const focusedSegmentRef = useRef<HTMLLIElement | null>(null)
  const focusNonce = focus?.nonce
  useEffect(() => {
    if (focusNonce === undefined) return
    focusedSegmentRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusNonce, recordingId])

  /**
   * 話者名の変更。要約は作り直さない（数分かかるので、名前を直すたびに走らせない）。
   * 直し終えてから「再要約」を押してもらう。
   */
  const renameSpeaker = useCallback(
    async (speakerId: string, label: string): Promise<void> => {
      setError(undefined)
      setVoiceNotice(undefined)
      try {
        await window.recorder.renameSpeaker(recordingId, speakerId, label)
        onChanged()
      } catch (renameError: unknown) {
        setError(messageOf(renameError))
        throw renameError
      }
    },
    [recordingId, onChanged]
  )

  /**
   * 発言の本文の訂正。話者名と同じく要約は作り直さない。直し終えてから
   * 「再要約」を押してもらう。
   */
  const editSegmentText = useCallback(
    async (index: number, startMs: number, text: string): Promise<void> => {
      setError(undefined)
      try {
        await window.recorder.editSegmentText(recordingId, { index, startMs }, text)
        onChanged()
      } catch (editError: unknown) {
        setError(messageOf(editError))
        throw editError
      }
    },
    [recordingId, onChanged]
  )

  const editBlocker = transcriptEditBlocker(detail.recording.steps)

  // 失敗は、そのステップが作るはずだったものの欄に出す。何が欠けているかがその場で分かる。
  const transcriptFailures = failuresIn('transcript', detail.recording.steps)
  const summaryFailures = failuresIn('summary', detail.recording.steps)
  const audioFailures = failuresIn('audio', detail.recording.steps)

  /**
   * タイトルの変更。保存ディレクトリ名は変わらないので、既に書き出した
   * ファイルの場所や外部ツールで開いていたパスは壊れない。
   */
  const renameTitle = useCallback(
    async (title: string): Promise<void> => {
      setError(undefined)
      try {
        await window.recorder.renameRecording(recordingId, title)
        onChanged()
      } catch (renameError: unknown) {
        setError(messageOf(renameError))
        throw renameError
      }
    },
    [recordingId, onChanged]
  )

  const retry = useCallback(
    (step: PipelineStep): void => {
      window.recorder
        .retryStep(recordingId, step)
        .then(onChanged)
        .catch((retryError: unknown) => setError(messageOf(retryError)))
    },
    [recordingId, onChanged]
  )

  return (
    <section className="detail">
      <header className="detail__header">
        <div className="detail__heading">
          <EditableTitle value={detail.recording.title} onCommit={renameTitle} />
          <div className="detail__meta-row">
            <p className="detail__meta">
              {formatDateTime(detail.recording.startedAt)}
              {detail.recording.durationMs > 0 &&
                ` ・ ${formatDuration(detail.recording.durationMs)}`}
            </p>
            {showsPipelineProgress(detail.recording.status) && (
              <PipelinePill recording={detail.recording} />
            )}
          </div>
        </div>
        <div className="detail__actions">
          <button type="button" onClick={() => void window.recorder.revealRecording(recordingId)}>
            Finder で表示
          </button>
          <button type="button" className="danger" onClick={onDelete}>
            削除
          </button>
        </div>
      </header>

      {error && (
        <p className="detail__error" role="alert">
          {error}
        </p>
      )}

      {voiceNotice && (
        <p className="detail__notice" role="status">
          {voiceNotice}
        </p>
      )}

      <div
        className={[
          'player-slot',
          player === 'custom' && 'player-slot--custom',
          !audioReady && 'player-slot--pending'
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {player === 'custom' && (
          <PlayerControls
            playing={playing}
            positionMs={positionMs}
            durationMs={audioMs ?? detail.recording.durationMs}
            rate={rate}
            disabled={!audioReady}
            onToggle={togglePlayback}
            onChangeRate={() => setRate(nextPlaybackRate)}
          />
        )}
        {/* file: スキームで保存先の音声をそのまま再生する。まだ無いなら src を張らない */}
        <audio
          ref={audioRef}
          // 文字起こしが無ければ標準のプレーヤーに戻す（位置を動かす帯が出ないため）。
          // 独自の操作のときも要素は残す — 再生の本体はこの要素のまま。
          controls={player === 'native'}
          className="player"
          {...(audioReady ? { src: `file://${detail.audioPath}` } : {})}
        />
        <SpeakerTimeline
          lanes={lanes}
          tones={tones}
          durationMs={timelineMs}
          positionMs={positionMs}
          disabled={!audioReady}
          onSeek={seek}
        />
        {audioFailures.length > 0 ? (
          <StepFailures failures={audioFailures} onRetry={retry} />
        ) : (
          !audioReady && (
            <p className="player-slot__hint">{pendingAudioHint(detail.recording.status)}</p>
          )
        )}
      </div>

      <div className="detail__body">
        <div className="panel">
          <div className="panel__header">
            <h3>文字起こし</h3>
            <CopyButton text={detail.transcriptText} label="文字起こしをコピー" />
          </div>

          <StepFailures failures={transcriptFailures} onRetry={retry} />

          {detail.segments.length === 0 ? (
            transcriptFailures.length === 0 && (
              <p className="panel__empty">まだ文字起こしがありません。</p>
            )
          ) : (
            <ol className="segments" ref={segmentsRef}>
              {detail.segments.map((segment, index) => (
                <li
                  key={`${segment.startMs}-${index}`}
                  ref={index === focusedIndex ? focusedSegmentRef : undefined}
                  className={segmentClassName(index === focusedIndex, index === playingIndex)}
                  aria-current={index === playingIndex ? 'true' : undefined}
                >
                  <button
                    type="button"
                    className="segment__time"
                    // 押してもフォーカスを奪わない。本文を直している最中に聞き直すと、
                    // 編集欄の blur で直しかけの本文が確定されてしまうため。
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => seek(segment.startMs)}
                    disabled={!audioReady}
                    title={audioReady ? 'この位置から再生' : 'エンコードが終わると再生できます'}
                  >
                    {formatDuration(segment.startMs)}
                  </button>
                  <EditableSpeaker
                    label={labels.get(segment.speakerId) ?? segment.speakerId}
                    tone={tones.get(segment.speakerId)}
                    onCommit={(label) => renameSpeaker(segment.speakerId, label)}
                  />
                  <EditableSegmentText
                    text={segment.text}
                    blocker={editBlocker}
                    onCommit={(text) => editSegmentText(index, segment.startMs, text)}
                  />
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="panel">
          <div className="panel__header">
            <div className="tabs">
              <button
                type="button"
                className={tab === 'summary' ? 'tabs__tab tabs__tab--active' : 'tabs__tab'}
                onClick={() => setTab('summary')}
              >
                要約
              </button>
              <button
                type="button"
                className={tab === 'note' ? 'tabs__tab tabs__tab--active' : 'tabs__tab'}
                onClick={() => setTab('note')}
              >
                メモ
              </button>
            </div>

            {tab === 'summary' ? (
              <div className="panel__tools">
                {/* 話者名を直しても要約は古いままなので、作り直す手段をここに置く。 */}
                <button
                  type="button"
                  className="copy"
                  onClick={() => retry('summarize')}
                  disabled={resummarize !== 'ready'}
                  title={RESUMMARIZE_HINT[resummarize]}
                >
                  {resummarize === 'summarizing' ? '要約中…' : '再要約'}
                </button>
                {detail.summary && <CopyButton text={detail.summary} label="要約をコピー" />}
              </div>
            ) : (
              <span className="panel__hint">{noteSaved ? '保存済み' : '保存中…'}</span>
            )}
          </div>

          {tab === 'summary' ? (
            <>
              <StepFailures failures={summaryFailures} onRetry={retry} />
              {detail.summary ? (
                <div className="summary">
                  <Markdown source={detail.summary} />
                </div>
              ) : (
                summaryFailures.length === 0 && <p className="panel__empty">まだ要約がありません。</p>
              )}
            </>
          ) : (
            <textarea
              className="note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="この会議についてのメモを書けます（自動保存されます）"
            />
          )}
        </div>
      </div>
    </section>
  )
}

/** 状態ごとの短い表記。色だけに頼らず文字でも読めるようにする。 */
const STEP_STATE_LABELS: Readonly<Record<string, string>> = {
  pending: '待機',
  running: '処理中',
  done: '完了',
  failed: '失敗'
}

/**
 * 処理状況。タイトル下のピルに、いま動いているステップと残り時間を出し、
 * 押すとステップの一覧を重ねて開く。本文の欄は押し下げない。
 *
 * 失敗の全文と再実行はここに出さず、各欄に出す（StepFailures）。
 */
const PipelinePill = ({
  recording
}: {
  recording: RecordingDetailDto['recording']
}): ReactElement => {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const { samples, receivedAtMs } = useProgressSamples()
  const sample = samples[recording.id]
  const remainingMs = sample ? estimateRemainingMs(sample, receivedAtMs) : undefined

  // 外側を押す・Esc で閉じる。開いたままだと本文の先頭を覆い続ける。
  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div className="pipeline-pill" ref={rootRef}>
      <button
        type="button"
        className="pipeline-pill__button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="pipeline-pill__spinner" aria-hidden="true" />
        {pipelinePillLabel(recording.steps, sample, remainingMs)}
        <span className="pipeline-pill__chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <section className="pipeline-pop" aria-label="処理状況">
          <p className="pipeline-pop__header">
            <strong>処理中</strong>
            <span>ウィンドウを閉じても続きます</span>
          </p>
          <ol className="pipeline__steps">
            {PIPELINE_STEPS.map((step) => {
              const status = recording.steps[step]?.status ?? 'pending'
              const fraction =
                status === 'running' && sample?.step === step ? sample.fraction : undefined

              return (
                <li key={step} className={`pipeline__step pipeline__step--${status}`}>
                  <span className="pipeline__mark" aria-hidden="true" />
                  <span className="pipeline__label">{STEP_LABELS[step]}</span>
                  <span className="pipeline__state">
                    {fraction === undefined
                      ? STEP_STATE_LABELS[status]
                      : `${Math.round(fraction * 100)}%`}
                  </span>

                  {fraction !== undefined && (
                    <div
                      className="pipeline__bar"
                      role="progressbar"
                      aria-label={`${STEP_LABELS[step]}の進み具合`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(fraction * 100)}
                    >
                      <div className="pipeline__bar-fill" style={{ width: `${fraction * 100}%` }} />
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </div>
  )
}

/**
 * ある欄に属する失敗の全文と再実行。
 *
 * 全文は常に出す。以前はホバーで出していたが、マウスを外すと消えて
 * 読む・コピーする前に見失っていた。
 */
const StepFailures = ({
  failures,
  onRetry
}: {
  failures: ReadonlyArray<StepFailure & { readonly step: string }>
  onRetry: (step: PipelineStep) => void
}): ReactElement | null => {
  if (failures.length === 0) return null

  return (
    <ul className="failures">
      {failures.map((failure) => (
        <li key={failure.step} className="failure">
          <p className="failure__message" role="note">
            {failureTooltip(failure)}
          </p>
          <button
            type="button"
            className="failure__retry"
            onClick={() => onRetry(failure.step as PipelineStep)}
          >
            再実行
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * 進捗の通知から、録音ごとの割合の標本を持つ。
 *
 * 割合は保存されない一過性の値なので、録音の DTO には載せずここで受ける。
 * 画面を開き直すと標本は空に戻るが、次の通知（数十秒おき）でまた埋まる。
 */
const useProgressSamples = (): { samples: ProgressSamples; receivedAtMs: number } => {
  // 見積もりの「今」は最後に通知を受けた時刻に置く。描画のたびに時計を読むと、
  // 通知と関係ない再描画で残り時間が揺れる。
  const [progress, setProgress] = useState({ samples: {} as ProgressSamples, receivedAtMs: 0 })

  useEffect(
    () =>
      window.recorder.onProgress((event) => {
        const nowMs = Date.now()
        setProgress((current) => ({
          samples: applyProgressEvent(current.samples, event, nowMs),
          receivedAtMs: nowMs
        }))
      }),
    []
  )

  return progress
}

/** 検索から飛んできた印と再生中の印は重なりうる。再生中の方を後に置いて見た目で勝たせる。 */
const segmentClassName = (focused: boolean, playing: boolean): string =>
  ['segment', focused && 'segment--focused', playing && 'segment--playing']
    .filter(Boolean)
    .join(' ')

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
