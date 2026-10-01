import { describe, expect, it } from 'vitest'

import {
  PLAYBACK_RATES,
  formatPlaybackRate,
  isPlaybackToggleKey,
  nextPlaybackRate,
  playerMode,
  volumeLevel
} from '@renderer/library/playback'

describe('nextPlaybackRate', () => {
  it('押すたびに次の速さへ進む', () => {
    expect(nextPlaybackRate(1)).toBe(1.25)
    expect(nextPlaybackRate(1.25)).toBe(1.5)
  })

  it('最後まで行ったら最初に戻る（ボタン 1 つで一巡できる）', () => {
    expect(nextPlaybackRate(PLAYBACK_RATES[PLAYBACK_RATES.length - 1] ?? 1)).toBe(PLAYBACK_RATES[0])
  })

  it('一覧に無い速さからは等倍に戻す', () => {
    expect(nextPlaybackRate(3)).toBe(1)
  })
})

describe('formatPlaybackRate', () => {
  it('倍率を × 付きで表す', () => {
    expect(formatPlaybackRate(1.25)).toBe('1.25×')
  })

  it('等倍は 1× と書く（1.00× にしない）', () => {
    expect(formatPlaybackRate(1)).toBe('1×')
  })
})

describe('playerMode', () => {
  it('文字起こしがあれば独自の操作と話者の帯で再生する', () => {
    expect(playerMode(3)).toBe('custom')
  })

  it('文字起こしが無ければ標準のプレーヤーに戻す（帯が無いと位置を動かせない）', () => {
    expect(playerMode(0)).toBe('native')
  })
})

describe('isPlaybackToggleKey', () => {
  const space = {
    key: ' ',
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isComposing: false,
    targetTag: 'BODY',
    targetInputType: '',
    targetEditable: false,
    modalOpen: false
  }

  it('何も入力していないときの Space で再生・停止する', () => {
    expect(isPlaybackToggleKey(space)).toBe(true)
  })

  it('入力欄では Space を文字として通す（本文・話者名・メモを直している最中）', () => {
    for (const targetTag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(isPlaybackToggleKey({ ...space, targetTag })).toBe(false)
    }
    expect(isPlaybackToggleKey({ ...space, targetTag: 'DIV', targetEditable: true })).toBe(false)
  })

  it('音量のスライダーでは Space を奪ってよい（スライダーは Space を使わない）', () => {
    // 動かした直後はフォーカスがスライダーに残る。ここで効かないと、動かすたびに Space が死ぬ。
    expect(isPlaybackToggleKey({ ...space, targetTag: 'INPUT', targetInputType: 'range' })).toBe(true)
  })

  it('ボタンにフォーカスがあるときはボタンを押させる（二重に動かさない）', () => {
    expect(isPlaybackToggleKey({ ...space, targetTag: 'BUTTON' })).toBe(false)
  })

  it('標準のプレーヤーにフォーカスがあるときはプレーヤーに任せる', () => {
    expect(isPlaybackToggleKey({ ...space, targetTag: 'AUDIO' })).toBe(false)
  })

  it('モーダルが開いている間は奪わない', () => {
    expect(isPlaybackToggleKey({ ...space, modalOpen: true })).toBe(false)
  })

  it('修飾キー付きや押しっぱなしの繰り返し、変換中は無視する', () => {
    expect(isPlaybackToggleKey({ ...space, metaKey: true })).toBe(false)
    expect(isPlaybackToggleKey({ ...space, ctrlKey: true })).toBe(false)
    expect(isPlaybackToggleKey({ ...space, altKey: true })).toBe(false)
    expect(isPlaybackToggleKey({ ...space, repeat: true })).toBe(false)
    expect(isPlaybackToggleKey({ ...space, isComposing: true })).toBe(false)
  })

  it('Space 以外のキーは無視する', () => {
    expect(isPlaybackToggleKey({ ...space, key: 'k' })).toBe(false)
  })
})

describe('volumeLevel', () => {
  it('ミュート中は音量によらず muted', () => {
    expect(volumeLevel(0.8, true)).toBe('muted')
  })

  it('音量 0 も muted と見せる（鳴らないことに変わりはない）', () => {
    expect(volumeLevel(0, false)).toBe('muted')
  })

  it('半分未満は low、それ以上は high', () => {
    expect(volumeLevel(0.3, false)).toBe('low')
    expect(volumeLevel(0.5, false)).toBe('high')
  })
})
