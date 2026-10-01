import { afterEach, describe, expect, it } from 'vitest'
import type { VoiceprintDto } from '@shared/ipc'
import { filterVoiceprints, voiceprintCountLabel, voiceprintSummary } from '@renderer/library/voiceprints'
import { setLocale } from '@renderer/i18n/locale'

afterEach(() => {
  setLocale('ja')
})

describe('voiceprintSummary', () => {
  it('学習に使った録音の数と、最後に覚えた日を出す', () => {
    expect(voiceprintSummary({ name: '田中さん', samples: 3, updatedAt: '2026-09-10T09:00:00+09:00' })).toBe(
      '3 件の録音から学習 ・ 9月10日'
    )
  })

  it('1 件でも同じ形で出す', () => {
    expect(voiceprintSummary({ name: '佐藤さん', samples: 1, updatedAt: '2026-09-12T09:00:00+09:00' })).toBe(
      '1 件の録音から学習 ・ 9月12日'
    )
  })

  it('去年以前なら年を添える', () => {
    expect(voiceprintSummary({ name: '鈴木さん', samples: 2, updatedAt: '2024-03-01T09:00:00+09:00' })).toContain(
      '2024年'
    )
  })
})

/** 覚えた順（updatedAt 降順）に並んだ声紋帳。並びが保たれるかの検証にも使う。 */
const entries: readonly VoiceprintDto[] = [
  { name: '田中さん', samples: 3, updatedAt: '2026-09-12T09:00:00+09:00' },
  { name: 'Alice', samples: 1, updatedAt: '2026-09-11T09:00:00+09:00' },
  { name: '田中部長', samples: 2, updatedAt: '2026-09-10T09:00:00+09:00' }
]

const namesOf = (list: readonly VoiceprintDto[]): string[] => list.map((entry) => entry.name)

describe('filterVoiceprints', () => {
  it('絞り込み語が空なら全件を、与えた順のまま返す', () => {
    expect(namesOf(filterVoiceprints(entries, ''))).toEqual(['田中さん', 'Alice', '田中部長'])
  })

  it('空白だけの語も「絞り込んでいない」とみなす', () => {
    expect(filterVoiceprints(entries, '   ')).toHaveLength(3)
  })

  it('名前の一部で絞り、残った人の覚えた順は崩さない', () => {
    expect(namesOf(filterVoiceprints(entries, '田中'))).toEqual(['田中さん', '田中部長'])
  })

  it('英字の大文字小文字は区別しない', () => {
    expect(namesOf(filterVoiceprints(entries, 'alice'))).toEqual(['Alice'])
  })

  it('全角で打った英字でも半角の名前に当たる', () => {
    expect(namesOf(filterVoiceprints(entries, 'Ａｌｉｃｅ'))).toEqual(['Alice'])
  })

  it('一致が無ければ空になる', () => {
    expect(filterVoiceprints(entries, '佐藤')).toEqual([])
  })

  it('渡された配列を書き換えない', () => {
    filterVoiceprints(entries, '田中')

    expect(namesOf(entries)).toEqual(['田中さん', 'Alice', '田中部長'])
  })
})

describe('voiceprintCountLabel', () => {
  it('覚えている人数を出す', () => {
    expect(voiceprintCountLabel(3)).toBe('3 人を覚えています')
  })

  it('1 人でも同じ形で出す', () => {
    expect(voiceprintCountLabel(1)).toBe('1 人を覚えています')
  })
})

describe('英語ロケール', () => {
  it('学習した録音数と日付を英語で出す（単数と複数で語尾を変える）', () => {
    setLocale('en')
    expect(voiceprintSummary({ name: 'Alice', samples: 3, updatedAt: '2026-09-10T09:00:00+09:00' })).toBe(
      'Learned from 3 recordings · September 10'
    )
    expect(voiceprintSummary({ name: 'Bob', samples: 1, updatedAt: '2026-09-12T09:00:00+09:00' })).toBe(
      'Learned from 1 recording · September 12'
    )
  })

  it('覚えている人数を英語で出す（単数と複数で語尾を変える）', () => {
    setLocale('en')
    expect(voiceprintCountLabel(3)).toBe('3 voices remembered')
    expect(voiceprintCountLabel(1)).toBe('1 voice remembered')
  })
})
