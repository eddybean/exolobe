import { afterEach, describe, expect, it } from 'vitest'
import type { ImportAudioResultDto, RecordingDto } from '@shared/ipc'
import {
  FOLDER_MIME,
  RECORDING_MIME,
  importSummary,
  isExternalFileDrag,
  nextDragDepth
} from '@renderer/library/fileDrop'
import { setLocale } from '@renderer/i18n/locale'

describe('isExternalFileDrag', () => {
  it('OS から来たファイルのドラッグを受け入れる', () => {
    expect(isExternalFileDrag(['Files'])).toBe(true)
  })

  it('ツリー内の録音・フォルダの移動には手を出さない', () => {
    expect(isExternalFileDrag([RECORDING_MIME])).toBe(false)
    expect(isExternalFileDrag([FOLDER_MIME])).toBe(false)
  })

  /**
   * 独自 MIME を載せたドラッグでも Chromium は Files を併記することがある。
   * ここで奪うとフォルダへの移動が効かなくなる。
   */
  it('独自 MIME が混ざっていれば外部ファイルとして扱わない', () => {
    expect(isExternalFileDrag(['Files', RECORDING_MIME])).toBe(false)
    expect(isExternalFileDrag(['Files', FOLDER_MIME])).toBe(false)
  })

  it('テキストの選択などは受け入れない', () => {
    expect(isExternalFileDrag([])).toBe(false)
    expect(isExternalFileDrag(['text/plain'])).toBe(false)
  })
})

describe('nextDragDepth', () => {
  /** 子要素をまたぐたびに leave が飛ぶので、数えていないとオーバーレイがちらつく。 */
  it('入った数だけ出るまで 0 に戻らない', () => {
    let depth = 0
    depth = nextDragDepth(depth, 'enter')
    depth = nextDragDepth(depth, 'enter')
    expect(depth).toBeGreaterThan(0)

    depth = nextDragDepth(depth, 'leave')
    expect(depth).toBeGreaterThan(0)

    depth = nextDragDepth(depth, 'leave')
    expect(depth).toBe(0)
  })

  it('ドロップしたら一度に 0 へ戻す', () => {
    expect(nextDragDepth(3, 'drop')).toBe(0)
  })

  it('余分な leave でも負にならない', () => {
    expect(nextDragDepth(0, 'leave')).toBe(0)
  })
})

const recording = (id: string): RecordingDto => ({
  id,
  title: id,
  startedAt: '2026-09-06T05:30:00.000Z',
  durationMs: 65_000,
  status: 'processing',
  steps: {
    mix: { status: 'pending' },
    transcribe: { status: 'pending' },
    diarize: { status: 'pending' },
    summarize: { status: 'pending' },
    encode: { status: 'pending' }
  },
  slug: id
})

const result = (imported: readonly RecordingDto[], failed: ImportAudioResultDto['failed']): ImportAudioResultDto => ({
  imported,
  failed
})

describe('importSummary', () => {
  it('全部取り込めたなら知らせない（一覧に出ることで分かる）', () => {
    expect(importSummary(result([recording('a')], []))).toBeUndefined()
  })

  it('何も渡されなければ知らせない', () => {
    expect(importSummary(result([], []))).toBeUndefined()
  })

  it('1 件だけ失敗したならその理由をそのまま出す', () => {
    const summary = importSummary(
      result([], [{ fileName: '会議.webm', reason: 'この形式の音声はまだ取り込めません。' }])
    )

    expect(summary).toContain('会議.webm')
    expect(summary).toContain('この形式の音声はまだ取り込めません。')
  })

  it('複数失敗したら件数とファイル名を挙げる', () => {
    const summary = importSummary(
      result(
        [recording('a')],
        [
          { fileName: 'x.webm', reason: 'だめ' },
          { fileName: 'y.mkv', reason: 'だめ' }
        ]
      )
    )

    expect(summary).toContain('2')
    expect(summary).toContain('x.webm')
    expect(summary).toContain('y.mkv')
  })
})

describe('英語表示', () => {
  afterEach(() => setLocale('ja'))

  it('1 件の失敗を英語で出す', () => {
    setLocale('en')
    const summary = importSummary(
      result([], [{ fileName: 'meeting.webm', reason: "This audio format isn't supported yet." }])
    )

    expect(summary).toBe(`Couldn't import "meeting.webm". This audio format isn't supported yet.`)
  })

  it('複数の失敗を英語で件数とファイル名付きで出す', () => {
    setLocale('en')
    const summary = importSummary(
      result(
        [],
        [
          { fileName: 'x.webm', reason: 'nope' },
          { fileName: 'y.mkv', reason: 'nope' }
        ]
      )
    )

    expect(summary).toBe(`Couldn't import 2 files: x.webm, y.mkv`)
  })
})
