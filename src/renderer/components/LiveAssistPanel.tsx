import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import type { AppleIntelligenceAvailability } from '@domain/AppleIntelligence'
import { captionLines } from '@domain/LiveCaption'
import { formatNoteStamp } from '@domain/MeetingNotes'
import type { LiveAssistSettings } from '@domain/Settings'
import type { LiveActionCandidateDto } from '@shared/ipc'
import { messageOf } from '../errorMessage'
import { formatDateTime } from '../format'
import type { LiveAssist } from '../hooks/useLiveAssist'
import { liveText } from '../i18n/live'
import { assistLayout, isPinnedToBottom } from '../library/liveAssist'

type Result =
  | { readonly kind: 'summary'; readonly points: readonly string[] }
  | { readonly kind: 'actions'; readonly candidates: readonly LiveActionCandidateDto[] }

/**
 * 録音中のアシスト（ADR-050、リサーチプレビュー）。字幕・今の話題・過去の会議のカードは自動で出し、
 * ここまでの要約と ToDo は押したときだけ作る。メモに書くのは「メモに追加」を押したときだけ。
 * 通知も音も出さない — 会議の邪魔にならないことを優先する。
 */
export const LiveAssistPanel = ({
  assist,
  settings,
  onAddToNotes,
  onOpenRecording
}: {
  assist: LiveAssist
  settings: LiveAssistSettings
  onAddToNotes: (texts: readonly string[]) => void
  onOpenRecording: (recordingId: string, startMs: number | undefined) => void
}): ReactElement | null => {
  const t = liveText().assist
  const [apple, setApple] = useState<AppleIntelligenceAvailability>()
  const [working, setWorking] = useState<Result['kind']>()
  const [result, setResult] = useState<Result>()
  const [added, setAdded] = useState<readonly string[]>([])
  const [error, setError] = useState<string>()
  const [pointsOpen, setPointsOpen] = useState(true)

  useEffect(() => {
    let alive = true
    window.recorder
      .getLiveAssistAvailability()
      .then((availability) => {
        if (alive) setApple(availability.appleIntelligence)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const layout = assistLayout(settings, apple)
  if (!layout.panel || assist.status.state === 'off') return null

  const run = async (kind: Result['kind']): Promise<void> => {
    setWorking(kind)
    setError(undefined)
    try {
      setResult(
        kind === 'summary'
          ? { kind, points: await window.recorder.liveSummarize() }
          : { kind, candidates: await window.recorder.liveExtractActions() }
      )
      setAdded([])
    } catch (runError: unknown) {
      setError(messageOf(runError))
    } finally {
      setWorking(undefined)
    }
  }

  const { status, suggestion, headline } = assist

  return (
    <section className="live__card live-assist" aria-label={t.ariaLabel}>
      <p className="live-assist__heading">
        <strong>{t.heading}</strong>
        <span className="live-assist__badge">{t.preview}</span>
      </p>

      {status.state === 'starting' && <p className="live__hint">{t.status.starting}</p>}
      {status.state === 'downloading' && <p className="live__hint">{t.status.downloading}</p>}
      {status.state === 'unavailable' && (
        <p className="live-assist__warning" role="status">
          {t.status.unavailable[status.reason]}
        </p>
      )}

      {layout.captions && <Captions assist={assist} />}

      {layout.headlines && headline && (
        <div className="live-assist__headline" aria-label={t.headline.ariaLabel}>
          <div className="live-assist__headline-row">
            <span className="live-assist__label">{t.headline.label}</span>
            <strong className="live-assist__headline-title">{headline.title}</strong>
            {headline.points.length > 0 && (
              <button
                type="button"
                className="live-assist__toggle"
                aria-expanded={pointsOpen}
                onClick={() => setPointsOpen((open) => !open)}
              >
                {pointsOpen ? t.headline.hide : t.headline.show}
              </button>
            )}
          </div>
          {pointsOpen && headline.points.length > 0 && (
            <ul className="live-assist__points">
              {headline.points.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {suggestion && (
        <div className="live-assist__suggestion" aria-label={t.suggestion.ariaLabel}>
          <div className="live-assist__suggestion-row">
            <span className="live-assist__label">{t.suggestion.label}</span>
            {suggestion.rangeLabel && <span className="live-assist__range">{suggestion.rangeLabel}</span>}
            <button
              type="button"
              className="live-assist__dismiss"
              aria-label={t.suggestion.dismiss}
              title={t.suggestion.dismiss}
              onClick={assist.dismissSuggestion}
            >
              ×
            </button>
          </div>
          <button
            type="button"
            className="live-assist__suggestion-open"
            onClick={() => onOpenRecording(suggestion.recordingId, suggestion.startMs)}
          >
            <strong>{suggestion.title}</strong>
            <span className="live-assist__suggestion-meta">
              {formatDateTime(suggestion.startedAt)}
              {suggestion.startMs !== undefined && ` · ${t.suggestion.at(formatNoteStamp(suggestion.startMs))}`}
            </span>
            <span className="live-assist__excerpt">{suggestion.excerpt}</span>
            <span className="live-assist__open">{t.suggestion.open}</span>
          </button>
        </div>
      )}

      {layout.actions && (
        <>
          <div className="live-assist__actions">
            <button type="button" disabled={working !== undefined} onClick={() => void run('summary')}>
              {working === 'summary' ? t.actions.working : t.actions.summarize}
            </button>
            <button type="button" disabled={working !== undefined} onClick={() => void run('actions')}>
              {working === 'actions' ? t.actions.working : t.actions.extract}
            </button>
          </div>
          {error && (
            <p className="live-assist__warning" role="alert">
              {error}
            </p>
          )}
          {result && (
            <div className="live-assist__result">
              {result.kind === 'summary' &&
                (result.points.length === 0 ? (
                  <p className="live__hint">{t.actions.empty}</p>
                ) : (
                  <ul className="live-assist__points">
                    {result.points.map((point, index) => (
                      <li key={index}>{point}</li>
                    ))}
                  </ul>
                ))}
              {result.kind === 'actions' &&
                (result.candidates.length === 0 ? (
                  <p className="live__hint">{t.actions.empty}</p>
                ) : (
                  <ul className="live-assist__candidates">
                    {result.candidates.map((candidate, index) => {
                      const done = added.includes(candidate.noteText)
                      return (
                        <li key={index}>
                          <span className={`live-assist__kind live-assist__kind--${candidate.kind}`}>
                            {candidate.kind === 'todo' ? t.actions.todo : t.actions.decision}
                          </span>
                          <span className="live-assist__candidate-text">{candidate.text}</span>
                          <button
                            type="button"
                            disabled={done}
                            onClick={() => {
                              onAddToNotes([candidate.noteText])
                              setAdded((current) => [...current, candidate.noteText])
                            }}
                          >
                            {done ? t.actions.added : t.actions.addToNotes}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ))}
              <div className="live-assist__result-footer">
                <span className="live-assist__caution">{t.actions.caution}</span>
                <button type="button" onClick={() => setResult(undefined)}>
                  {t.actions.close}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** 字幕の枠。高さを固定して最下部を追いかけ、上へ読み戻している間は止める。 */
const Captions = ({ assist }: { assist: LiveAssist }): ReactElement => {
  const t = liveText().assist.captions
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const lines = captionLines(assist.captions)

  useLayoutEffect(() => {
    const element = box.current
    if (element && pinned.current) element.scrollTop = element.scrollHeight
  }, [assist.captions])

  return (
    <div className="live-assist__captions-wrap">
      <div
        ref={box}
        className="live-assist__captions"
        role="log"
        aria-live="off"
        aria-label={t.ariaLabel}
        onScroll={(event) => {
          pinned.current = isPinnedToBottom(event.currentTarget)
        }}
      >
        {lines.length === 0 ? (
          <p className="live-assist__captions-empty">{t.empty}</p>
        ) : (
          lines.map((line) => (
            <p
              key={`${line.track}-${line.startMs}-${line.pending ? 'p' : 'f'}`}
              className={`live-assist__caption live-assist__caption--${line.track}${line.pending ? ' live-assist__caption--pending' : ''}`}
            >
              <span className="live-assist__speaker">{line.track === 'self' ? t.self : t.remote}</span>
              <span>
                {line.clipped ? '…' : ''}
                {line.text}
              </span>
            </p>
          ))
        )}
      </div>
      <p className="live-assist__note">{t.note}</p>
    </div>
  )
}
