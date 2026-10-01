import { describe, expect, it } from 'vitest'

import { matchTranscript, parseKeywordQuery, type TranscriptKeywordMatch } from '@domain/TranscriptKeywordSearch'
import type { TranscriptSegment } from '@domain/TranscriptSegment'

const segment = (startMs: number, text: string, speakerId = 'remote:spk0'): TranscriptSegment => ({
  startMs,
  endMs: startMs + 3_000,
  speakerId,
  text
})

/** 抜粋の中で ranges が指している文字列（ハイライト対象）を取り出す。 */
const highlighted = (match: TranscriptKeywordMatch): string[] =>
  match.ranges.map((range) => match.excerpt.slice(range.start, range.start + range.length))

describe('parseKeywordQuery', () => {
  it('空白で語に分ける（全角の空白も区切りとして扱う）', () => {
    expect(parseKeywordQuery('予算　見直し 来期')).toEqual(['予算', '見直し', '来期'])
  })

  it('空白だけのクエリは語を持たない', () => {
    expect(parseKeywordQuery('   　 ')).toEqual([])
  })

  it('同じ語を繰り返しても 1 つに畳む（同じ条件を二重に課さない）', () => {
    expect(parseKeywordQuery('予算 予算')).toEqual(['予算'])
  })
})

describe('matchTranscript', () => {
  it('本文に含む発言を、その時刻と話者ごと返す', () => {
    const segments = [segment(0, 'おはようございます'), segment(5_000, '来期の予算について話しましょう', 'self')]

    const matches = matchTranscript(segments, ['予算'])

    expect(matches).toHaveLength(1)
    expect(matches[0]?.startMs).toBe(5_000)
    expect(matches[0]?.speakerId).toBe('self')
    expect(matches[0]?.excerpt).toBe('来期の予算について話しましょう')
  })

  it('語が 1 つも無ければ何も返さない（空のクエリで全件を出さない）', () => {
    expect(matchTranscript([segment(0, '予算の話')], [])).toEqual([])
  })

  it('大文字小文字と全角を畳んで照合する（型番や固有名詞を打ち方で取りこぼさない）', () => {
    const matches = matchTranscript([segment(0, '型番は ＡＢＣ-123 です')], ['abc-123'])

    expect(matches).toHaveLength(1)
    expect(highlighted(matches[0]!)).toEqual(['ＡＢＣ-123'])
  })

  it('複数の語は同じ発言に全部そろったときだけヒットする', () => {
    const segments = [
      segment(0, '予算の話をします'),
      segment(5_000, '来期の予算を見直します'),
      segment(10_000, '見直しは来月です')
    ]

    const matches = matchTranscript(segments, ['予算', '見直'])

    expect(matches.map((match) => match.startMs)).toEqual([5_000])
    expect(highlighted(matches[0]!)).toEqual(['予算', '見直'])
  })

  it('同じ発言に語が何度も出たら、その全部をハイライトの対象にする', () => {
    const matches = matchTranscript([segment(0, '予算、とにかく予算の話')], ['予算'])

    expect(highlighted(matches[0]!)).toEqual(['予算', '予算'])
  })

  it('長い発言は該当箇所の周りだけを切り出し、省いた側を … で示す', () => {
    const long = `${'あ'.repeat(200)}予算${'い'.repeat(200)}`

    const match = matchTranscript([segment(0, long)], ['予算'])[0]!

    expect(match.excerpt.startsWith('…')).toBe(true)
    expect(match.excerpt.endsWith('…')).toBe(true)
    expect(match.excerpt.length).toBeLessThanOrEqual(122)
    expect(highlighted(match)).toEqual(['予算'])
  })

  it('末尾近くで当たっても、当たった語は抜粋の先頭側に置く', () => {
    // 一覧は抜粋を 2 行で打ち切る。末尾に寄せて切り出すと、当たった語が
    // その 2 行の外に落ちて「なぜ当たったのか」が見えなくなる。
    const long = `${'あ'.repeat(200)}予算です`

    const match = matchTranscript([segment(0, long)], ['予算'])[0]!

    expect(match.ranges[0]?.start).toBeLessThanOrEqual(31)
    expect(match.excerpt.endsWith('予算です')).toBe(true)
  })

  it('短い発言は切り出さないので … を付けない', () => {
    const match = matchTranscript([segment(0, '予算の話')], ['予算'])[0]!

    expect(match.excerpt).toBe('予算の話')
  })

  it('件数の上限で打ち切る（1 件の録音が結果を埋め尽くさない）', () => {
    const segments = [0, 1, 2, 3].map((index) => segment(index * 1_000, '予算の話'))

    expect(matchTranscript(segments, ['予算'], 2)).toHaveLength(2)
  })
})
