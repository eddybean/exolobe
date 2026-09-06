import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { PipelineStep } from '@domain/Recording'
import type { RecordingDetailDto } from '@shared/ipc'
import { STEP_LABELS, formatDateTime, formatDuration } from '../format'
import { CopyButton } from '../components/CopyButton'

const PIPELINE_STEPS: PipelineStep[] = ['mix', 'transcribe', 'diarize', 'summarize', 'encode']

/** メモの自動保存までの待ち時間。打鍵のたびに書かないため。 */
const NOTE_SAVE_DELAY_MS = 600

type Tab = 'summary' | 'note'

/**
 * 詳細画面。左に音声プレーヤーと話者付き文字起こし、右に要約とメモを置く。
 * 要約・文字起こしはそれぞれコピーでき、メモは編集して自動保存される。
 */
export const RecordingDetailView = ({
  detail,
  onChanged
}: {
  detail: RecordingDetailDto
  onChanged: () => void
}): ReactElement => {
  const [tab, setTab] = useState<Tab>('summary')
  const [note, setNote] = useState(detail.note)
  const [noteSaved, setNoteSaved] = useState(true)
  const [error, setError] = useState<string>()
  const audioRef = useRef<HTMLAudioElement>(null)

  const recordingId = detail.recording.id

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

  const seek = useCallback((ms: number): void => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = ms / 1000
    void audio.play()
  }, [])

  const renameSpeaker = useCallback(
    (speakerId: string, current: string): void => {
      const label = window.prompt('話者名を入力してください', current)
      if (label === null) return

      window.recorder
        .renameSpeaker(recordingId, speakerId, label)
        .then(onChanged)
        .catch((renameError: unknown) => setError(messageOf(renameError)))
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
        <div>
          <h2>{detail.recording.title}</h2>
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
          {/* file: スキームで保存先の音声をそのまま再生する */}
          <audio ref={audioRef} controls src={`file://${detail.audioPath}`} className="player" />

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
                      title="この位置から再生"
                    >
                      {formatDuration(segment.startMs)}
                    </button>
                    <button
                      type="button"
                      className="segment__speaker"
                      onClick={() =>
                        renameSpeaker(
                          segment.speakerId,
                          labels.get(segment.speakerId) ?? segment.speakerId
                        )
                      }
                      title="話者名を変更"
                    >
                      {labels.get(segment.speakerId) ?? segment.speakerId}
                    </button>
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
            <div className="panel panel--fill">
              <div className="panel__header">
                <h3>要約</h3>
                {detail.summary && <CopyButton text={detail.summary} label="要約をコピー" />}
              </div>
              {detail.summary ? (
                <pre className="summary">{detail.summary}</pre>
              ) : (
                <p className="panel__empty">まだ要約がありません。</p>
              )}
            </div>
          ) : (
            <div className="panel panel--fill">
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
      return (
        <li key={step} className={`steps__item steps__item--${state?.status ?? 'pending'}`}>
          <span>{STEP_LABELS[step]}</span>
          {state?.status === 'failed' && (
            <button type="button" className="steps__retry" onClick={() => onRetry(step)}>
              再実行
            </button>
          )}
          {state?.error && <span className="steps__error">{state.error}</span>}
        </li>
      )
    })}
  </ul>
)

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
