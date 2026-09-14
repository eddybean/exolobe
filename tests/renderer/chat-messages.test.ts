import { describe, expect, it } from 'vitest'
import {
  MAX_HISTORY_TURNS,
  answerNotice,
  appendChunk,
  completeMessage,
  startTurn,
  toHistory,
  withInlineSources,
  type ChatMessage
} from '@renderer/chat/messages'
import type { ChatCitationDto } from '@shared/ipc'

const user = (id: string, text: string): ChatMessage => ({
  id,
  role: 'user',
  text,
  streaming: false
})

const assistant = (id: string, text: string, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: 'assistant',
  text,
  streaming: false,
  ...overrides
})

describe('startTurn', () => {
  it('質問と、これから書かれる空の回答を並べて置く', () => {
    const messages = startTurn([], 'req-1', '先週のTODOをまとめて')

    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'user', text: '先週のTODOをまとめて' })
    // 空の回答を先に置くことで、「考え中」の表示が別の仕組みにならずに済む。
    expect(messages[1]).toMatchObject({ id: 'req-1', role: 'assistant', text: '', streaming: true })
  })
})

describe('appendChunk', () => {
  it('requestId が一致する回答にだけ追記する', () => {
    const messages: ChatMessage[] = [
      assistant('req-1', '見積', { streaming: true }),
      assistant('req-2', '別の', { streaming: true })
    ]

    const next = appendChunk(messages, 'req-1', 'もり')

    expect(next[0]?.text).toBe('見積もり')
    expect(next[1]?.text).toBe('別の')
  })

  it('知らない requestId なら何も変えない', () => {
    const messages = [assistant('req-1', '見積', { streaming: true })]

    expect(appendChunk(messages, 'req-9', 'もり')).toEqual(messages)
  })
})

describe('completeMessage', () => {
  it('最終テキストで丸ごと置き換え、streaming を下ろす', () => {
    const messages = [assistant('req-1', '見積も', { streaming: true })]

    const next = completeMessage(messages, {
      requestId: 'req-1',
      text: '見積もりの提出です。',
      citations: [],
      droppedCount: 0,
      truncated: false,
      aborted: false
    })

    expect(next[0]).toMatchObject({ text: '見積もりの提出です。', streaming: false })
  })

  it('中断なら、そこまでの本文を残したうえで中断と記す', () => {
    const messages = [assistant('req-1', '見積も', { streaming: true })]

    const next = completeMessage(messages, {
      requestId: 'req-1',
      text: '見積も',
      citations: [],
      droppedCount: 0,
      truncated: false,
      aborted: true
    })

    expect(next[0]).toMatchObject({ text: '見積も', aborted: true, streaming: false })
  })

  it('失敗なら理由を持たせ、本文は空のままにする', () => {
    const messages = [assistant('req-1', '', { streaming: true })]

    const next = completeMessage(messages, {
      requestId: 'req-1',
      text: '',
      citations: [],
      droppedCount: 0,
      truncated: false,
      aborted: false,
      error: 'モデルがありません'
    })

    expect(next[0]).toMatchObject({ error: 'モデルがありません', streaming: false })
  })

  it('引用と対象の表記を持ち回る', () => {
    const messages = [assistant('req-1', '', { streaming: true })]
    const citations = [
      {
        recordingId: 'rec-1',
        title: '週次定例',
        startedAt: '2026-09-08T05:30:00.000Z',
        source: 'summary' as const,
        truncated: false
      }
    ]

    const next = completeMessage(messages, {
      requestId: 'req-1',
      text: '答え',
      citations,
      scopeLabel: '先週（08/31〜09/06）の 1 件',
      droppedCount: 0,
      truncated: false,
      aborted: false
    })

    expect(next[0]?.citations).toEqual(citations)
    expect(next[0]?.scopeLabel).toBe('先週（08/31〜09/06）の 1 件')
  })
})

describe('toHistory', () => {
  it('生成中の回答は履歴に含めない', () => {
    const messages = [
      user('u1', '先週のTODOは？'),
      assistant('req-1', '見積もりです。'),
      user('u2', 'もっと詳しく'),
      assistant('req-2', '書きかけ', { streaming: true })
    ]

    expect(toHistory(messages)).toEqual([
      { role: 'user', text: '先週のTODOは？' },
      { role: 'assistant', text: '見積もりです。' },
      { role: 'user', text: 'もっと詳しく' }
    ])
  })

  it('失敗した回答は履歴に含めない', () => {
    const messages = [
      user('u1', '先週のTODOは？'),
      assistant('req-1', '', { error: 'モデルがありません' })
    ]

    expect(toHistory(messages)).toEqual([{ role: 'user', text: '先週のTODOは？' }])
  })

  it('直近のターンだけに切る', () => {
    const messages: ChatMessage[] = []
    for (let index = 0; index < 10; index += 1) {
      messages.push(user(`u${index}`, `質問${index}`), assistant(`a${index}`, `回答${index}`))
    }

    const history = toHistory(messages)

    // 文脈を毎ターン作り直すぶん、履歴は短く保たないと 32K がすぐ埋まる。
    expect(history).toHaveLength(MAX_HISTORY_TURNS)
    expect(history.at(-1)).toEqual({ role: 'assistant', text: '回答9' })
  })

  it('中断した回答は、そこまでの本文を履歴に残す', () => {
    const messages = [user('u1', '質問'), assistant('req-1', '途中まで', { aborted: true })]

    expect(toHistory(messages)).toEqual([
      { role: 'user', text: '質問' },
      { role: 'assistant', text: '途中まで' }
    ])
  })
})

describe('withInlineSources', () => {
  const citations: ChatCitationDto[] = [
    {
      recordingId: 'rec-1',
      title: '週次定例',
      startedAt: '2026-09-04T05:00:00.000Z',
      source: 'summary',
      truncated: false
    },
    {
      recordingId: 'rec-2',
      title: 'A社との商談',
      startedAt: '2026-09-02T01:00:00.000Z',
      source: 'summary',
      truncated: false
    }
  ]

  it('番号を出典のタイトルと日付に置き換える', () => {
    const text = '- [ ] 求人票を更新する [1]'

    expect(withInlineSources(text, citations)).toBe('- [ ] 求人票を更新する（週次定例 9月4日）')
  })

  it('番号が 2 つまでならどちらも出す', () => {
    const text = '- 見積もりの話 [1][2]'

    expect(withInlineSources(text, citations)).toBe(
      '- 見積もりの話（週次定例 9月4日）（A社との商談 9月2日）'
    )
  })

  it('番号が 3 つ以上並んだら先頭だけ出して件数でまとめる', () => {
    // 毎回の定例に出てくる項目は出典が会議の数だけ並び、1 行が読めなくなる。
    const many: ChatCitationDto[] = Array.from({ length: 8 }, (_unused, i) => ({
      recordingId: `rec-${i}`,
      title: `会議${i + 1}`,
      startedAt: '2026-09-04T05:00:00.000Z',
      source: 'summary',
      truncated: false
    }))
    const text = '- 議事録を共有する [1][2][3][4][5][6][7][8]'

    expect(withInlineSources(text, many)).toBe('- 議事録を共有する（会議1 9月4日 ほか7件）')
  })

  it('カンマ区切りで 1 つの括弧に書かれても置き換える', () => {
    // モデルは [1][2] とも [1, 2] とも書く。どちらも根拠の並びとして扱う。
    const text = '- 見積もりの話 [1, 2]'

    expect(withInlineSources(text, citations)).toBe(
      '- 見積もりの話（週次定例 9月4日）（A社との商談 9月2日）'
    )
  })

  it('カンマ区切りが 3 つ以上でも件数でまとめる', () => {
    const many: ChatCitationDto[] = Array.from({ length: 8 }, (_unused, i) => ({
      recordingId: `rec-${i}`,
      title: `会議${i + 1}`,
      startedAt: '2026-09-04T05:00:00.000Z',
      source: 'summary',
      truncated: false
    }))

    expect(withInlineSources('- 議事録を共有する [1, 2, 3, 4, 5, 6, 7, 8]', many)).toBe(
      '- 議事録を共有する（会議1 9月4日 ほか7件）'
    )
  })

  it('離れた位置の番号はまとめない', () => {
    const text = '- 見積もりの話 [1] と 採用の話 [2]'

    expect(withInlineSources(text, citations)).toBe(
      '- 見積もりの話（週次定例 9月4日） と 採用の話（A社との商談 9月2日）'
    )
  })

  it('チェックボックスの [ ] は番号ではないので触らない', () => {
    const text = '- [ ] 佐藤さんへメッセージを送る [2]'

    expect(withInlineSources(text, citations)).toBe(
      '- [ ] 佐藤さんへメッセージを送る（A社との商談 9月2日）'
    )
  })

  it('出典に無い番号はそのまま残す', () => {
    expect(withInlineSources('謎の根拠 [9]', citations)).toBe('謎の根拠 [9]')
  })

  it('出典が無ければ何も変えない', () => {
    expect(withInlineSources('答え [1]', [])).toBe('答え [1]')
  })

  it('番号の前の空白は詰める', () => {
    expect(withInlineSources('求人票を更新する  [1]', citations)).toBe(
      '求人票を更新する（週次定例 9月4日）'
    )
  })
})

describe('completeMessage — 空の最終テキスト', () => {
  it('最終テキストが空なら、流れてきた本文を残す', () => {
    // prompt() の戻り値が空でも断片は届いていることがある。
    // 丸ごと置き換えると、読めていた答えが消える。
    const messages = [assistant('req-1', '見積もりの提出です。', { streaming: true })]

    const next = completeMessage(messages, {
      requestId: 'req-1',
      text: '',
      citations: [],
      droppedCount: 0,
      truncated: false,
      aborted: false
    })

    expect(next[0]?.text).toBe('見積もりの提出です。')
    expect(next[0]?.streaming).toBe(false)
  })

  it('最終テキストがあれば、それで置き換える', () => {
    const messages = [assistant('req-1', '見積も', { streaming: true })]

    const next = completeMessage(messages, {
      requestId: 'req-1',
      text: '見積もりの提出です。',
      citations: [],
      droppedCount: 0,
      truncated: false,
      aborted: false
    })

    expect(next[0]?.text).toBe('見積もりの提出です。')
  })
})

describe('completeMessage — 打ち切られた回答', () => {
  it('上限で切れたことを持ち回る', () => {
    const messages = [assistant('req-1', '途中まで', { streaming: true })]

    const next = completeMessage(messages, {
      requestId: 'req-1',
      text: '途中まで',
      citations: [],
      droppedCount: 0,
      truncated: true,
      aborted: false
    })

    expect(next[0]?.truncated).toBe(true)
  })
})

describe('answerNotice', () => {
  it('上限で切れた回答は、続きがあることを伝える', () => {
    // 黙って尻切れにすると、利用者はそれが全部だと思う。
    expect(answerNotice(assistant('req-1', '途中まで', { truncated: true }))).toContain(
      '長すぎた'
    )
  })

  it('切れていない回答には何も言わない', () => {
    expect(answerNotice(assistant('req-1', '答え', { truncated: false }))).toBeUndefined()
  })


  it('本文も理由も無い回答は、答えが返らなかったと伝える', () => {
    // 何も描かないと、出典の一覧だけが残って「それが答え」に見える。
    expect(answerNotice(assistant('req-1', ''))).toContain('答えが返りませんでした')
  })

  it('本文があれば何も言わない', () => {
    expect(answerNotice(assistant('req-1', '答え'))).toBeUndefined()
  })

  it('生成中は何も言わない', () => {
    expect(answerNotice(assistant('req-1', '', { streaming: true }))).toBeUndefined()
  })

  it('失敗は理由がそちらで出るので何も言わない', () => {
    expect(answerNotice(assistant('req-1', '', { error: 'モデルがありません' }))).toBeUndefined()
  })

  it('中断で本文が無い場合は、中断の表示に任せる', () => {
    expect(answerNotice(assistant('req-1', '', { aborted: true }))).toBeUndefined()
  })

  it('質問には何も言わない', () => {
    expect(answerNotice(user('u1', '先週のTODOは？'))).toBeUndefined()
  })
})
