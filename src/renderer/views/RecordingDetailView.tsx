import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { PipelineStep } from '@domain/Recording'
import type { RecordingDetailDto } from '@shared/ipc'
import { STEP_LABELS, formatDateTime, formatDuration } from '../format'
import { CopyButton } from '../components/CopyButton'
import { Markdown } from '../components/Markdown'
import { EditableTitle } from '../components/EditableTitle'
import { EditableSpeaker } from '../components/EditableSpeaker'
import { isAudioReady } from '../library/audio'
import { resummarizeState, type ResummarizeState } from '../resummarize'
import { failureTooltip, stepFailure } from '../stepFailure'

const PIPELINE_STEPS: PipelineStep[] = ['mix', 'transcribe', 'diarize', 'summarize', 'encode']

/** メモの自動保存までの待ち時間。打鍵のたびに書かないため。 */
const NOTE_SAVE_DELAY_MS = 600

type Tab = 'summary' | 'note'

/** 再要約ボタンのツールチップ。押せないときは、その理由をその場で読めるようにする。 */
const RESUMMARIZE_HINT: Readonly<Record<ResummarizeState, string>> = {
  ready: '話者名を直したあとなど、要約を作り直す',
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
  onChanged,
  onDelete
}: {
  detail: RecordingDetailDto
  onChanged: () => void
  onDelete: () => void
}): ReactElement => {
  const [tab, setTab] = useState<Tab>('summary')
  const [note, setNote] = useState(detail.note)
  const [noteSaved, setNoteSaved] = useState(true)
  const [error, setError] = useState<string>()
  const audioRef = useRef<HTMLAudioElement>(null)

  const recordingId = detail.recording.id
  // エンコードが終わるまで音声ファイルは無い。再生手段はまとめて無効にする。
  const audioReady = isAudioReady(detail.recording)

  // 別の録音に切り替わったら編集中の内容を持ち越さない。
  useEffect(() => {
    setNote(detail.note)
    setNoteSaved(true)
  }, [recordingId, detail.note])

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
   * 話者名の変更。要約は作り直さない（数分かかるので、名前を直すたびに走らせない）。
   * 直し終えてから「再要約」を押してもらう。
   */
  const renameSpeaker = useCallback(
    async (speakerId: string, label: string): Promise<void> => {
      setError(undefined)
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
                  <li key={`${segment.startMs}-${index}`} className="segment">
                    <button
                      type="button"
                      className="segment__time"
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
                    <p className="segment__text">{segment.text}</p>
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

/** ステップごとの状態。失敗したステップだけ個別に再実行できる。 */
const PipelineStatus = ({
  recording,
  onRetry
}: {
  recording: RecordingDetailDto['recording']
  onRetry: (step: PipelineStep) => void
}): ReactElement => (
  <ul className="steps">
    {PIPELINE_STEPS.map((step) => {
      const state = recording.steps[step]
      const failure = stepFailure(step, state)
      return (
        <li
          key={step}
          className={`steps__item steps__item--${state?.status ?? 'pending'}`}
          // 文言はバッヂの外へ。中に描くと省略されて読めず、列も横に伸びていた。
          {...(failure ? { title: failureTooltip(failure) } : {})}
        >
          <span>{STEP_LABELS[step]}</span>
          {failure && (
            <>
              <button type="button" className="steps__retry" onClick={() => onRetry(step)}>
                再実行
              </button>
              {/* ネイティブ由来の英語エラーは検索・報告に持ち出したくなる。 */}
              <CopyButton
                text={failureTooltip(failure)}
                label={`${failure.label}のエラーをコピー`}
              />
            </>
          )}
        </li>
      )
    })}
  </ul>
)

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
