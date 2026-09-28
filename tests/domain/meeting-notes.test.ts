import { describe, expect, it } from 'vitest'
import {
  formatNoteStamp,
  noteMoments,
  parseNote,
  serializeNote,
  stampLines,
  summaryNotes,
  type NoteLine
} from '@domain/MeetingNotes'
import type { Speaker } from '@domain/Speaker'
import type { TranscriptSegment } from '@domain/TranscriptSegment'

describe('formatNoteStamp', () => {
  it('経過ミリ秒を hh:mm:ss にする（1 時間未満でも時を出して桁を揃える）', () => {
    expect(formatNoteStamp(190_500)).toBe('00:03:10')
    expect(formatNoteStamp(3_723_000)).toBe('01:02:03')
  })
})

describe('stampLines', () => {
  it('書き始めた行にその時点の経過時間を付ける', () => {
    expect(stampLines([], 'エクスポート', 3_000)).toEqual([{ text: 'エクスポート', atMs: 3_000 }])
  })

  it('既にある行を書き足しても時刻は書き始めのまま', () => {
    const before: NoteLine[] = [{ text: 'エクスポ', atMs: 3_000 }]
    expect(stampLines(before, 'エクスポート', 9_000)).toEqual([{ text: 'エクスポート', atMs: 3_000 }])
  })

  it('改行しただけの空行には付けず、書き始めたときに付ける', () => {
    const first = stampLines([{ text: 'a', atMs: 1_000 }], 'a\n', 5_000)
    expect(first).toEqual([{ text: 'a', atMs: 1_000 }, { text: '' }])

    expect(stampLines(first, 'a\nb', 8_000)).toEqual([
      { text: 'a', atMs: 1_000 },
      { text: 'b', atMs: 8_000 }
    ])
  })

  it('箇条書きの記号だけではまだ書き始めていない', () => {
    expect(stampLines([], '- ', 2_000)).toEqual([{ text: '- ' }])
    expect(stampLines([{ text: '- ' }], '- 価格', 4_000)).toEqual([{ text: '- 価格', atMs: 4_000 }])
  })

  it('間に行を差し込んでも、前後の行の時刻は動かない', () => {
    const before: NoteLine[] = [
      { text: 'a', atMs: 1_000 },
      { text: 'c', atMs: 3_000 }
    ]
    expect(stampLines(before, 'a\nb\nc', 9_000)).toEqual([
      { text: 'a', atMs: 1_000 },
      { text: 'b', atMs: 9_000 },
      { text: 'c', atMs: 3_000 }
    ])
  })

  it('行を消すと、その行の時刻も消える', () => {
    const before: NoteLine[] = [
      { text: 'a', atMs: 1_000 },
      { text: 'b', atMs: 2_000 },
      { text: 'c', atMs: 3_000 }
    ]
    expect(stampLines(before, 'a\nc', 9_000)).toEqual([
      { text: 'a', atMs: 1_000 },
      { text: 'c', atMs: 3_000 }
    ])
  })

  it('中身を消して空にした行は、書き直したときの時刻を取り直す', () => {
    const emptied = stampLines([{ text: 'a', atMs: 1_000 }], '', 5_000)
    expect(emptied).toEqual([{ text: '' }])
    expect(stampLines(emptied, 'b', 7_000)).toEqual([{ text: 'b', atMs: 7_000 }])
  })
})

describe('serializeNote / parseNote', () => {
  it('時刻を箇条書きの記号の後ろに埋めて note.md にする', () => {
    const lines: NoteLine[] = [
      { text: '- エクスポートは次スプリント', atMs: 190_000 },
      { text: '価格改定', atMs: 582_000 },
      { text: '' },
      { text: '  * 入れ子', atMs: 600_000 }
    ]
    expect(serializeNote(lines)).toBe(
      [
        '- [00:03:10] エクスポートは次スプリント',
        '[00:09:42] 価格改定',
        '',
        '  * [00:10:00] 入れ子'
      ].join('\n')
    )
  })

  it('note.md から読み戻すと元の行に戻る（録音中に画面を開き直しても時刻を失わない）', () => {
    const lines: NoteLine[] = [
      { text: '- エクスポート', atMs: 190_000 },
      { text: '1. 価格改定', atMs: 3_723_000 },
      { text: '時刻なし' }
    ]
    expect(parseNote(serializeNote(lines))).toEqual(lines)
  })

  it('空の note.md は空の 1 行になる', () => {
    expect(parseNote('')).toEqual([{ text: '' }])
  })

  it('mm:ss の表記も読める（後から手で書き足した時刻）', () => {
    expect(parseNote('- [14:32] 手書き')).toEqual([{ text: '- 手書き', atMs: 872_000 }])
  })
})

describe('noteMoments', () => {
  it('時刻つきの行を、記号を除いた本文と一緒に返す', () => {
    const note = ['- [00:03:10] エクスポート', '見出し', '[00:09:42] 価格改定', '- [00:10:00]   '].join(
      '\n'
    )
    expect(noteMoments(note)).toEqual([
      { atMs: 190_000, text: 'エクスポート' },
      { atMs: 582_000, text: '価格改定' }
    ])
  })
})

describe('summaryNotes', () => {
  const speakers: Speaker[] = [
    { id: 'self', kind: 'self', label: '自分' },
    { id: 'remote', kind: 'remote', label: '田中' }
  ]
  const segments: TranscriptSegment[] = [
    { startMs: 0, endMs: 5_000, speakerId: 'self', text: 'はじめます' },
    { startMs: 860_000, endMs: 875_000, speakerId: 'remote', text: '告知は 10 月 15 日で確定です' },
    { startMs: 900_000, endMs: 910_000, speakerId: 'self', text: '了解です' }
  ]

  it('メモも印も無ければ空文字（プロンプトに何も足さない）', () => {
    expect(summaryNotes({ note: '  \n', marks: [], segments, speakers, language: 'ja' })).toBe('')
  })

  it('メモを見出しつきで渡す', () => {
    const text = summaryNotes({
      note: '- [00:03:10] エクスポートは次スプリント',
      marks: [],
      segments,
      speakers,
      language: 'ja'
    })
    expect(text).toContain('会議中のメモ')
    expect(text).toContain('- [00:03:10] エクスポートは次スプリント')
    expect(text).not.toContain('印')
  })

  it('印は、押した時点で話されていた発言を添えて渡す（4B のモデルに時刻の突き合わせをさせない）', () => {
    const text = summaryNotes({ note: '', marks: [{ atMs: 872_000 }], segments, speakers, language: 'ja' })
    expect(text).toContain('印')
    expect(text).toContain('田中「告知は 10 月 15 日で確定です」')
    expect(text).not.toContain('はじめます')
    expect(text).not.toContain('会議中のメモ')
  })

  it('押すのが少し遅れても直前の発言を拾う', () => {
    const text = summaryNotes({ note: '', marks: [{ atMs: 885_000 }], segments, speakers, language: 'ja' })
    expect(text).toContain('告知は 10 月 15 日で確定です')
  })

  it('英語の会議には英語の見出しと説明を付け、発言は英語の引用符で添える', () => {
    const text = summaryNotes({
      note: '- [00:03:10] Export ships next sprint',
      marks: [{ atMs: 872_000 }],
      segments,
      speakers,
      language: 'en'
    })
    expect(text).toContain('## Notes taken during the meeting')
    expect(text).toContain('## Moments marked as important')
    expect(text).toContain('田中: “告知は 10 月 15 日で確定です”')
    expect(text).not.toContain('会議中のメモ')
    expect(text).not.toContain('利用者')
  })

  it('近くに発言が無い印は時刻だけ渡す', () => {
    const text = summaryNotes({ note: '', marks: [{ atMs: 400_000 }], segments, speakers, language: 'ja' })
    expect(text).toContain('[06:40]')
  })
})
