import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { transcriptEditBlocker, type PipelineStep } from '@domain/Recording'
import type { RecordingDetailDto } from '@shared/ipc'
import { STEP_LABELS, formatDateTime, formatDuration } from '../format'
import { CopyButton } from '../components/CopyButton'
import { Markdown } from '../components/Markdown'
import { EditableTitle } from '../components/EditableTitle'
import { EditableSpeaker } from '../components/EditableSpeaker'
import { EditableSegmentText } from '../components/EditableSegmentText'
import { isAudioReady } from '../library/audio'
import { focusedSegmentIndex } from '../library/transcriptSearch'
import { voiceLearnedNotice } from '../library/voiceLearning'
import { resummarizeState, type ResummarizeState } from '../resummarize'
import { failureTooltip, stepFailure } from '../stepFailure'
import {
  applyProgressEvent,
  estimateRemainingMs,
  formatRemaining,
  visiblePipelineSteps,
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
 * 詳細画面。左に音声プレーヤーと話者付き文字起こし、右に要約とメモを置く。
 * 要約・文字起こしはそれぞれコピーでき、メモは編集して自動保存される。
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

  const resummarize = useMemo(
    () => resummarizeState(detail.recording.steps, detail.segments.length > 0),
    [detail.recording.steps, detail.segments.length]
  )

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
          <p className="detail__meta">
            {formatDateTime(detail.recording.startedAt)}
            {detail.recording.durationMs > 0 &&
              ` ・ ${formatDuration(detail.recording.durationMs)}`}
          </p>
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

      <PipelineStatus recording={detail.recording} onRetry={retry} />

      <div className="detail__body">
        <div className="detail__left">
          <div className={audioReady ? 'player-slot' : 'player-slot player-slot--pending'}>
            {/* file: スキームで保存先の音声をそのまま再生する。まだ無いなら src を張らない */}
            <audio
              ref={audioRef}
              controls
              className="player"
              {...(audioReady ? { src: `file://${detail.audioPath}` } : {})}
            />
            {!audioReady && (
              <p className="player-slot__hint">
                エンコードが終わると再生できます。処理が終わるまでお待ちください。
              </p>
            )}
          </div>

          <div className="panel">
            <div className="panel__header">
              <h3>文字起こし</h3>
              <CopyButton text={detail.transcriptText} label="文字起こしをコピー" />
            </div>

            {detail.segments.length === 0 ? (
              <p className="panel__empty">まだ文字起こしがありません。</p>
            ) : (
              <ol className="segments">
                {detail.segments.map((segment, index) => (
                  <li
                    key={`${segment.startMs}-${index}`}
                    ref={index === focusedIndex ? focusedSegmentRef : undefined}
                    className={index === focusedIndex ? 'segment segment--focused' : 'segment'}
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
        </div>

        <div className="detail__right">
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
            <div className="panel">
              <div className="panel__header">
                <h3>要約</h3>
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
              </div>
              {detail.summary ? (
                <div className="summary">
                  <Markdown source={detail.summary} />
                </div>
              ) : (
                <p className="panel__empty">まだ要約がありません。</p>
              )}
            </div>
          ) : (
            <div className="panel">
              <div className="panel__header">
                <h3>メモ</h3>
                <span className="panel__hint">{noteSaved ? '保存済み' : '保存中…'}</span>
              </div>
              <textarea
                className="note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="この会議についてのメモを書けます（自動保存されます）"
              />
            </div>
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
 * 処理状況。処理中はステップを縦に並べて進み具合を見せ、終わったら失敗だけを残す。
 *
 * 失敗の全文はそのステップの直下に常に出す。以前はホバーで出していたが、
 * マウスを外すと消えて読む・コピーする前に見失っていた。
 */
const PipelineStatus = ({
  recording,
  onRetry
}: {
  recording: RecordingDetailDto['recording']
  onRetry: (step: PipelineStep) => void
}): ReactElement | null => {
  const { samples, receivedAtMs } = useProgressSamples()
  const visible = visiblePipelineSteps(recording.steps, recording.status)
  if (visible.length === 0) return null

  const sample = samples[recording.id]
  const processing = recording.status === 'processing'
  const remainingMs = sample ? estimateRemainingMs(sample, receivedAtMs) : undefined

  return (
    <section className="pipeline" aria-label="処理状況">
      <p className="pipeline__summary">
        {processing ? '処理中' : '一部の処理が失敗しました'}
        {processing && (
          <span className="pipeline__hint">
            {remainingMs !== undefined && `${formatRemaining(remainingMs)} ・ `}
            ウィンドウを閉じても続きます
          </span>
        )}
      </p>

      <ol className="pipeline__steps">
        {visible.map((step) => {
          const state = recording.steps[step as PipelineStep]
          const status = state?.status ?? 'pending'
          const failure = stepFailure(step, state)
          const fraction = status === 'running' && sample?.step === step ? sample.fraction : undefined

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

              {failure && (
                <div className="pipeline__problem">
                  <p className="pipeline__failure" role="note">
                    {failureTooltip(failure)}
                  </p>
                  <button
                    type="button"
                    className="pipeline__retry"
                    onClick={() => onRetry(step as PipelineStep)}
                  >
                    再実行
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
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

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
