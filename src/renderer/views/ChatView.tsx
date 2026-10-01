import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { ChatCitationDto } from '@shared/ipc'
import { Markdown } from '../components/Markdown'
import { formatDateTime } from '../format'
import { answerNotice, withInlineSources } from '../chat/messages'
import { chatText } from '../i18n/chat'
import type { ChatController } from '../hooks/useChat'

/** 引用の並びは答えの中の [1] [2] と同じ。番号で辿れるようにする。 */
const Citations = ({
  citations,
  onOpenRecording
}: {
  citations: readonly ChatCitationDto[]
  onOpenRecording: (recordingId: string) => void
}): ReactElement | null => {
  if (citations.length === 0) return null
  const t = chatText()

  return (
    <ul className="chat__citations">
      {citations.map((citation, index) => (
        <li key={citation.recordingId}>
          <button
            type="button"
            className="chat__citation"
            onClick={() => onOpenRecording(citation.recordingId)}
            title={citation.title}
          >
            <span className="chat__citation-index">[{index + 1}]</span>
            <span className="chat__citation-title">{citation.title}</span>
            <span className="chat__citation-meta">
              {t.citationMeta(formatDateTime(citation.startedAt), citation.source, citation.truncated)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * ライブラリ全体に問いかける画面。
 *
 * 録音の詳細の隣ではなく独立した画面に置く。チャットの相手は「選択中の 1 件」では
 * なくライブラリ全体で、詳細ペインの横に並べると対象が何なのか画面が嘘をつく。
 *
 * 会話そのものは App が持つ。引用から録音へ飛ぶとこの画面は外れるので、
 * ここで持つと戻ってきたときに会話が消えてしまう。
 */
export const ChatView = ({
  chat,
  onOpenRecording
}: {
  chat: ChatController
  onOpenRecording: (recordingId: string) => void
}): ReactElement => {
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const t = chatText()

  // 生成につれて下に伸びるので、常に最後を見せる。
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [chat.messages])

  const generating = chat.pendingId !== undefined
  const availability = chat.availability
  const blocked =
    availability === undefined
      ? undefined
      : !availability.enabled
        ? t.chatDisabled
        : !availability.modelInstalled
          ? t.modelNotInstalled
          : availability.busyReason

  const submit = (): void => {
    if (generating || blocked !== undefined) return
    chat.ask(draft)
    setDraft('')
  }

  return (
    <section className="chat">
      <header className="chat__header">
        <h2 className="chat__heading">{t.heading}</h2>
        <p className="chat__lead">{t.lead}</p>
        {chat.messages.length > 0 && (
          <button type="button" className="chat__reset" onClick={chat.reset}>
            {t.newConversation}
          </button>
        )}
      </header>

      <div className="chat__log" ref={logRef}>
        {chat.messages.length === 0 && (
          <div className="chat__empty">
            <p>{t.emptyHint}</p>
            <ul className="chat__examples">
              {t.examples.map((example) => (
                <li key={example}>
                  <button type="button" className="chat__example" onClick={() => setDraft(example)}>
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {chat.messages.map((message) => (
          <article
            key={message.id}
            className={[
              'chat__message',
              `chat__message--${message.role}`,
              message.streaming ? 'chat__message--streaming' : ''
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {message.scopeLabel !== undefined && <p className="chat__scope">{t.scopePrefix(message.scopeLabel)}</p>}

            {message.error !== undefined ? (
              <p className="chat__error" role="alert">
                {message.error}
              </p>
            ) : message.role === 'assistant' ? (
              // 本文の [1] は、出典の会議名と日付に置き換えてから描く。
              <Markdown source={withInlineSources(message.text, message.citations ?? [])} />
            ) : (
              <p className="chat__question">{message.text}</p>
            )}

            {message.streaming && message.text === '' && <p className="chat__thinking">{t.thinking}</p>}
            {(() => {
              const notice = answerNotice(message)
              return notice === undefined ? null : <p className="chat__truncated">{notice}</p>
            })()}
            {message.aborted === true && <p className="chat__aborted">{t.aborted}</p>}

            {message.citations !== undefined && (
              <Citations citations={message.citations} onOpenRecording={onOpenRecording} />
            )}
          </article>
        ))}
      </div>

      {blocked !== undefined && <output className="chat__notice">{blocked}</output>}

      <form
        className="chat__composer"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <textarea
          className="chat__input"
          value={draft}
          placeholder={t.composerPlaceholder}
          rows={2}
          disabled={blocked !== undefined}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // 改行は Shift+Enter。Enter だけで送れる方が会話のテンポに合う。
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        {generating ? (
          <button type="button" className="chat__stop" onClick={chat.cancel}>
            {t.stop}
          </button>
        ) : (
          <button type="submit" className="chat__send" disabled={draft.trim().length === 0 || blocked !== undefined}>
            {t.send}
          </button>
        )}
      </form>
    </section>
  )
}
