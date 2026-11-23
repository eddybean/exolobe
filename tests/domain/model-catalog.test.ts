import { describe, expect, it } from 'vitest'

import { MANAGED_ASSETS, findPackage, requiredAssets } from '@domain/ModelCatalog'

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

describe('Haas-ja-v1.0 のパッケージ', () => {
  const haas = findPackage('haas-ja')

  it('モデルの 5 ファイルと VAD を 1 つのパッケージとして取得させる', () => {
    expect(haas?.assets.map((asset) => asset.id)).toEqual([
      'haas-encoder',
      'haas-encoder-data',
      'haas-decoder',
      'haas-joiner',
      'haas-tokens',
      'haas-vad'
    ])
    expect(haas?.bytes).toBe(haas?.assets.reduce((sum, asset) => sum + asset.bytes, 0))
  })

  it('任意で、録音を通すのに欠かせないものには入れない', () => {
    expect(haas?.optional).toBe(true)
    expect(requiredAssets().filter((asset) => asset.id.startsWith('haas-'))).toEqual([])
  })

  it('encoder が相対名で引く encoder.data と同じディレクトリに、元の名前のまま置く', () => {
    const files = Object.fromEntries((haas?.assets ?? []).map((asset) => [asset.id, asset.fileName]))

    expect(files['haas-encoder']).toBe('haas-ja-v1.0/encoder.quantized.onnx')
    expect(files['haas-encoder-data']).toBe('haas-ja-v1.0/encoder.data')
  })

  it('取得したパスを設定の Haas の項目に書く', () => {
    const patches = (haas?.assets ?? []).map((asset) => asset.applyTo(`/m/${asset.fileName}`))

    expect(patches).toEqual([
      { transcription: { haasEncoderPath: '/m/haas-ja-v1.0/encoder.quantized.onnx' } },
      // encoder.data は encoder が自分で読むので、設定に書く項目が無い。
      {},
      { transcription: { haasDecoderPath: '/m/haas-ja-v1.0/decoder.onnx' } },
      { transcription: { haasJoinerPath: '/m/haas-ja-v1.0/joiner.onnx' } },
      { transcription: { haasTokensPath: '/m/haas-ja-v1.0/tokens.txt' } },
      { transcription: { haasVadModelPath: '/m/silero_vad.onnx' } }
    ])
  })
})
