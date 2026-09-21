import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MANAGED_ASSETS } from '@domain/ModelCatalog'
import { LICENSE_TEXTS } from '@domain/LicenseTexts'
import { NOTICE_GROUPS, THIRD_PARTY_NOTICES, usedLicenses } from '@domain/ThirdPartyNotices'

/**
 * ライセンス表記が、実際に使っているものと食い違わないことを確かめる。
 *
 * 表記は「一度書いたら忘れる」ものなので、依存やモデルを足したときに
 * 更新し忘れても誰も気付かない。package.json と ModelCatalog を突き合わせて、
 * 増えたものが表記から漏れたらここで落ちるようにしておく。
 */
const packageJson: { dependencies: Record<string, string> } = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf8')
)

describe('第三者ソフトウェアの表記', () => {
  it('グループに分けた一覧が、全体の一覧と一致する', () => {
    const grouped = NOTICE_GROUPS.flatMap((group) => group.entries)

    expect(grouped).toEqual([...THIRD_PARTY_NOTICES])
  })

  it('名前が重複しない', () => {
    const names = THIRD_PARTY_NOTICES.map((notice) => notice.name)

    expect(new Set(names).size).toBe(names.length)
  })

  it('すべての項目が出所の URL を持つ', () => {
    for (const notice of THIRD_PARTY_NOTICES) {
      expect(notice.url, notice.name).toMatch(/^https:\/\//)
    }
  })

  it('挙げたライセンスの全文または参照先が揃っている', () => {
    for (const notice of THIRD_PARTY_NOTICES) {
      expect(LICENSE_TEXTS[notice.license], notice.name).toBeDefined()
    }
  })

  it('同梱する npm 依存がすべて載っている', () => {
    const covered = new Set(
      THIRD_PARTY_NOTICES.flatMap((notice) => (notice.packageName ? [notice.packageName] : []))
    )

    for (const name of Object.keys(packageJson.dependencies)) {
      expect(covered, `${name} のライセンス表記がありません`).toContain(name)
    }
  })

  it('ダウンロードして使うモデルがすべて載っている', () => {
    const covered = new Set(THIRD_PARTY_NOTICES.flatMap((notice) => notice.assetIds ?? []))

    for (const asset of MANAGED_ASSETS) {
      expect(covered, `${asset.id} のライセンス表記がありません`).toContain(asset.id)
    }
  })

  it('MIT と BSD-3-Clause は全文を持つ（写しの同梱が条件のため）', () => {
    expect(LICENSE_TEXTS['MIT'].body).toMatch(/Permission is hereby granted/)
    expect(LICENSE_TEXTS['BSD-3-Clause'].body).toMatch(/Redistributions of source code/)
    expect(LICENSE_TEXTS['Apache-2.0'].body).toMatch(/Apache License/)
  })

  it('全文を見せるのは、実際に出てくるライセンスだけ', () => {
    const licenses = usedLicenses([
      { name: 'A', license: 'MIT', url: 'https://example.com/a' },
      { name: 'B', license: 'MIT', url: 'https://example.com/b' },
      { name: 'C', license: 'Apache-2.0', url: 'https://example.com/c' }
    ])

    expect(licenses).toEqual(['MIT', 'Apache-2.0'])
  })

  it('著作権表示を載せた項目は、原文のまま Copyright から始める', () => {
    for (const notice of THIRD_PARTY_NOTICES) {
      if (notice.copyright === undefined) continue
      expect(notice.copyright, notice.name).toMatch(/^Copyright/)
    }
  })
})
