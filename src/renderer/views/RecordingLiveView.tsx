import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import {
  formatNoteStamp,
  parseNote,
  serializeNote,
  stampLines,
  type Bookmark,
  type NoteLine
} from '@domain/MeetingNotes'
import type { RecordingDetailDto } from '@shared/ipc'
import { EditableTitle } from '../components/EditableTitle'
import { FlagIcon } from '../components/FlagIcon'
import type { Transport } from '../hooks/useTransport'
import { BOOKMARK_SHORTCUT_LABEL, isBookmarkKey } from '../keyboard'
import { litSegments } from '../library/liveNotes'
import { liveText } from '../i18n/live'
import { intlLocale, locale } from '../i18n/locale'

/** メモの自動保存までの待ち時間。詳細画面のメモと揃える。 */
const NOTE_SAVE_DELAY_MS = 600
const METER_SEGMENTS = 12

/**
 * 録音中の詳細画面（ADR-042）。左に録音の状態と印、右に会議中のメモを置く。
 *
 * メモは行ごとに書き始めの経過時間を覚え、note.md に `[hh:mm:ss]` で埋めて保存する。
 * 入力欄には時刻を出さない — 打っている最中に行頭が書き換わると書きにくい。
 * 録音中にするのは記録だけで、推論はしない（ADR-009）。
 */
export const RecordingLiveView = ({
  detail,
  transport,
  onChanged
}: {
  detail: RecordingDetailDto
  transport: Transport
  onChanged: () => void
}): ReactElement => {
  const recordingId = detail.recording.id
  const startedAtMs = transport.state.startedAtMs
  const [lines, setLines] = useState<NoteLine[]>(() => parseNote(detail.note))
  const [bookmarks, setBookmarks] = useState<readonly Bookmark[]>(detail.bookmarks)
  const [noteSaved, setNoteSaved] = useState(true)
  const [error, setError] = useState<string>()

  /** 打鍵・押下の瞬間の経過時間。200ms おきの表示用の値より細かく取る。 */
  const elapsedNow = useCallback(
    (): number => (startedAtMs === undefined ? 0 : Math.max(0, Date.now() - startedAtMs)),
    [startedAtMs]
  )

  // 保存済みの本文と、まだ書いていない本文。閉じるときに書き残しを出すのに使う。
  // 基準は読み戻して書き直した形にする。手書きの `[mm:ss]` が `[00:mm:ss]` に揃うだけで保存が走らないように。
  const saved = useRef(serializeNote(lines))
  const unsaved = useRef<string | undefined>(undefined)
  const changed = useRef(onChanged)
  useEffect(() => {
    changed.current = onChanged
  }, [onChanged])

  const save = useCallback(
    (note: string): Promise<void> =>
      window.recorder.updateNote(recordingId, note).then(() => {
        saved.current = note
        if (unsaved.current === note) {
          unsaved.current = undefined
          setNoteSaved(true)
        }
      }),
    [recordingId]
  )

  // 入力が止まってから保存する。
  useEffect(() => {
    const note = serializeNote(lines)
    if (note === saved.current) return

    unsaved.current = note
    setNoteSaved(false)
    const timer = window.setTimeout(() => {
      save(note).catch((saveError: unknown) => setError(messageOf(saveError)))
    }, NOTE_SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [lines, save])

  // 停止するとこの画面は即座に外れる。待ち時間の間に書いた分を落とさないよう、
  // 外れるときに書き残しを保存し、詳細を読み直させる（通常の詳細が古いメモで開かないように）。
  useEffect(
    () => () => {
      const note = unsaved.current
      if (note === undefined) return
      window.recorder
        .updateNote(recordingId, note)
        .then(() => changed.current())
        .catch(() => undefined)
    },
    [recordingId]
  )

  const addBookmark = useCallback((): void => {
    const atMs = elapsedNow()
    setBookmarks((current) => [...current, { atMs }])
    window.recorder
      .addBookmark(recordingId, atMs)
      .catch((addError: unknown) => setError(messageOf(addError)))
  }, [elapsedNow, recordingId])

  // メモを書いている最中でも印をつけられるよう、入力欄ではなく window で受ける。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isBookmarkKey(event)) return
      event.preventDefault()
      addBookmark()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addBookmark])

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

  const t = liveText()
  const startedAt = new Date(detail.recording.startedAt).toLocaleTimeString(intlLocale(), {
    // 英語は 12 時間制の慣習どおり時を 0 で埋めない（format.ts の formatDateTime と揃える）。
    hour: locale() === 'ja' ? '2-digit' : 'numeric',
    minute: '2-digit'
  })

  return (
    <section className="detail live" aria-label={t.sectionAriaLabel}>
      {error && (
        <p className="detail__error" role="alert">
          {error}
        </p>
      )}

      <div className="live__body">
        <div className="live__side">
          <section className="live__card" aria-label={t.status.ariaLabel}>
            <p className="live__status">
              <span className="live__dot" aria-hidden="true" />
              <span className="live__status-label">{t.status.label}</span>
              <span className="live__started">{t.status.startedAt(startedAt)}</span>
            </p>
            <EditableTitle value={detail.recording.title} onCommit={renameTitle} />
            <p className="live__clock" aria-label={t.status.elapsedAriaLabel}>
              {formatNoteStamp(transport.elapsedMs)}
            </p>
            <Meter
              label={t.meter.remoteLabel}
              source={t.meter.remoteSource}
              tone="remote"
              level={transport.levels.system}
            />
            <Meter
              label={t.meter.selfLabel}
              source={t.meter.selfSource}
              tone="self"
              level={transport.levels.mic}
            />
          </section>

          <section className="live__card" aria-label={t.bookmark.sectionAriaLabel}>
            <div className="live__mark-row">
              <button type="button" className="live__mark" onClick={addBookmark}>
                <FlagIcon />
                {t.bookmark.button}
              </button>
              <kbd className="live__kbd">{BOOKMARK_SHORTCUT_LABEL}</kbd>
            </div>
            <p className="live__hint">{t.bookmark.hint}</p>
            {bookmarks.length > 0 && (
              <ol className="live__marks">
                {[...bookmarks]
                  .sort((a, b) => b.atMs - a.atMs)
                  .map((bookmark, index) => (
                    <li key={`${bookmark.atMs}-${index}`}>
                      <span className="live__mark-time">{formatNoteStamp(bookmark.atMs)}</span>
                      <span>{t.bookmark.text}</span>
                    </li>
                  ))}
              </ol>
            )}
          </section>
        </div>

        <section className="panel live__notes" aria-label={t.notes.sectionAriaLabel}>
          <div className="panel__header">
            <div className="live__notes-heading">
              <h3>{t.notes.heading}</h3>
              <span className="panel__hint">{t.notes.hint}</span>
            </div>
            <span className="panel__hint">{noteSaved ? t.notes.saved : t.notes.saving}</span>
          </div>
          <textarea
            className="note"
            value={lines.map((line) => line.text).join('\n')}
            onChange={(event) => {
              const text = event.target.value
              const atMs = elapsedNow()
              setLines((current) => stampLines(current, text, atMs))
            }}
            placeholder={t.notes.placeholder}
            aria-label={t.notes.ariaLabel}
          />
          <p className="live__footnote">{t.notes.footnote}</p>
        </section>
      </div>
    </section>
  )
}

/** トラックごとのメーター。マイクが取れていないことは無音と見分けて文字で出す。 */
const Meter = ({
  label,
  source,
  tone,
  level
}: {
  label: string
  source: string
  tone: 'self' | 'remote'
  level: number | undefined
}): ReactElement => {
  const lit = level === undefined ? 0 : litSegments(level, METER_SEGMENTS)
  const t = liveText().meter

  return (
    <div className={`live__meter live__meter--${tone}`}>
      <p className="live__meter-label">
        <strong>{label}</strong>
        <span>{source}</span>
        {level === undefined && <span className="live__meter-off">{t.unavailable}</span>}
      </p>
      <div
        className="live__meter-bars"
        role="meter"
        aria-label={t.ariaLabel(label)}
        aria-valuemin={0}
        aria-valuemax={METER_SEGMENTS}
        aria-valuenow={lit}
      >
        {Array.from({ length: METER_SEGMENTS }, (_, index) => (
          <span
            key={index}
            className={index < lit ? 'live__meter-bar live__meter-bar--on' : 'live__meter-bar'}
          />
        ))}
      </div>
    </div>
  )
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
