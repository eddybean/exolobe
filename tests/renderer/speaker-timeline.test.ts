import { describe, expect, it } from 'vitest'

import {
  activeSegmentIndex,
  followScrollTop,
  seekTargetMs,
  speakerLanes,
  speakerTones,
  timelineDurationMs
} from '@renderer/library/timeline'

const speakers = [
  { id: 'self', kind: 'self' as const, label: '自分' },
  { id: 'remote:spk0', kind: 'remote' as const, label: '田中' },
  { id: 'remote:spk1', kind: 'remote' as const, label: '佐藤' }
]

const segments = [
  { startMs: 0, endMs: 2_000, speakerId: 'remote:spk1', text: 'はじめます' },
  { startMs: 2_000, endMs: 5_000, speakerId: 'self', text: 'お願いします' },
  { startMs: 6_000, endMs: 9_000, speakerId: 'remote:spk0', text: '議題です' },
  { startMs: 9_500, endMs: 12_000, speakerId: 'self', text: 'はい' }
]

describe('speakerTones', () => {
  it('自分は常に 0 番の色にする（どの録音でも自分の色が変わらない）', () => {
    expect(speakerTones(speakers).get('self')).toBe(0)
  })

  it('相手は話者の並び順に 1 番から色を振る', () => {
    const tones = speakerTones(speakers)

    expect(tones.get('remote:spk0')).toBe(1)
    expect(tones.get('remote:spk1')).toBe(2)
  })

  it('自分のいない録音（取り込み）でも相手は 1 番から振る', () => {
    const tones = speakerTones([{ id: 'remote', kind: 'remote', label: '相手' }])

    expect(tones.get('remote')).toBe(1)
  })

  it('相手が色の数より多ければ 1 番から巡回する（0 番の自分とは重ねない）', () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      id: `remote:spk${index}`,
      kind: 'remote' as const,
      label: `話者 ${index}`
    }))
    const tones = speakerTones(many, 6)

    expect(tones.get('remote:spk4')).toBe(5)
    expect(tones.get('remote:spk5')).toBe(1)
    expect(tones.get('remote:spk6')).toBe(2)
  })
})

describe('timelineDurationMs', () => {
  it('録音の長さを使う', () => {
    expect(timelineDurationMs(60_000, segments)).toBe(60_000)
  })

  it('最後の発言が録音の長さを越えていれば、そこまで伸ばす（帯がはみ出さない）', () => {
    expect(timelineDurationMs(10_000, segments)).toBe(12_000)
  })
})

describe('speakerLanes', () => {
  it('自分の段を先頭に、相手は話し始めた順に並べる', () => {
    const lanes = speakerLanes(segments, speakers)

    expect(lanes.map((lane) => lane.speakerId)).toEqual(['self', 'remote:spk1', 'remote:spk0'])
  })

  it('段には話者名と、その話者の発言の区間を持たせる', () => {
    const lanes = speakerLanes(segments, speakers)

    expect(lanes[0]).toEqual({
      speakerId: 'self',
      label: '自分',
      spans: [
        { startMs: 2_000, endMs: 5_000 },
        { startMs: 9_500, endMs: 12_000 }
      ]
    })
  })

  it('発言の無い話者の段は作らない', () => {
    const lanes = speakerLanes(segments.slice(0, 1), speakers)

    expect(lanes.map((lane) => lane.speakerId)).toEqual(['remote:spk1'])
  })

  it('話者の一覧に無い ID は ID のまま名前にする（文字起こしの行と同じ扱い）', () => {
    const lanes = speakerLanes([{ startMs: 0, endMs: 1, speakerId: 'remote', text: 'x' }], [])

    expect(lanes[0]?.label).toBe('remote')
  })
})

describe('activeSegmentIndex', () => {
  it('再生位置を含む発言を返す', () => {
    expect(activeSegmentIndex(segments, 7_000)).toBe(2)
  })

  it('発言の終わりちょうどは次の発言に渡す', () => {
    expect(activeSegmentIndex(segments, 2_000)).toBe(1)
  })

  it('重なっているときは後から話し始めた方を返す（割り込んだ発言を追う）', () => {
    const overlapping = [
      { startMs: 0, endMs: 10_000, speakerId: 'remote', text: '長い説明' },
      { startMs: 4_000, endMs: 5_000, speakerId: 'self', text: 'なるほど' }
    ]

    expect(activeSegmentIndex(overlapping, 4_500)).toBe(1)
  })

  it('発言の間の短い無音では直前の発言を残す（強調が点滅しない）', () => {
    expect(activeSegmentIndex(segments, 9_200)).toBe(2)
  })

  it('長い無音では何も強調しない（黙っている間に古い発言を指し続けない）', () => {
    const sparse = [{ startMs: 0, endMs: 1_000, speakerId: 'self', text: 'では' }]

    expect(activeSegmentIndex(sparse, 10_000)).toBe(-1)
  })

  it('最初の発言より前では何も強調しない', () => {
    expect(activeSegmentIndex(segments.slice(2), 1_000)).toBe(-1)
  })
})

describe('seekTargetMs', () => {
  const spans = [{ startMs: 6_000, endMs: 9_000 }]

  it('帯の上を押したら、その発言の頭から再生する（言いかけの途中から聞かせない）', () => {
    expect(seekTargetMs(spans, 0.4, 20_000)).toBe(6_000)
  })

  it('帯の無いところを押したら、押した位置から再生する', () => {
    expect(seekTargetMs(spans, 0.75, 20_000)).toBe(15_000)
  })

  it('端をはみ出した位置は録音の範囲に収める', () => {
    expect(seekTargetMs(spans, -0.1, 20_000)).toBe(0)
    expect(seekTargetMs(spans, 1.2, 20_000)).toBe(20_000)
  })
})

describe('followScrollTop', () => {
  const view = { scrollTop: 100, viewHeight: 300 }

  it('発言が見えていれば動かさない（読んでいる位置を奪わない）', () => {
    expect(followScrollTop({ ...view, itemTop: 150, itemHeight: 40 })).toBeUndefined()
  })

  it('下に外れたら、発言が上から 3 分の 1 に来るまで送る（続きも見えるように）', () => {
    expect(followScrollTop({ ...view, itemTop: 500, itemHeight: 40 })).toBe(400)
  })

  it('上に外れたときも同じ位置へ戻す', () => {
    expect(followScrollTop({ ...view, itemTop: 20, itemHeight: 40 })).toBe(0)
  })

  it('一部だけ見えている発言も送る', () => {
    expect(followScrollTop({ ...view, itemTop: 380, itemHeight: 40 })).toBe(280)
  })
})
