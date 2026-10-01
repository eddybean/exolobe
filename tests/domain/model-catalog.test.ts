import { describe, expect, it } from 'vitest'

import { MANAGED_ASSETS } from '@domain/ModelCatalog'

describe('MANAGED_ASSETS', () => {
  it('Hugging Face の URL はブランチではなくコミットで固定する', () => {
    // resolve/main は上流の差し替えでチェックサムが合わなくなり、新規のダウンロードが壊れる。
    const unpinned = MANAGED_ASSETS.filter(
      (asset) => asset.url.startsWith('https://huggingface.co/') && !/\/resolve\/[0-9a-f]{40}\//.test(asset.url)
    ).map((asset) => asset.id)
    expect(unpinned).toEqual([])
  })

  it('すべてのファイルにチェックサムを持たせる', () => {
    // GitHub のリリース資産も後から差し替えられるため、URL だけでは同じ中身を保証できない。
    const missing = MANAGED_ASSETS.filter((asset) => asset.sha256 === undefined).map((asset) => asset.id)
    expect(missing).toEqual([])
  })
})
