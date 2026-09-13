import { existsSync } from 'node:fs'

/**
 * sherpa-onnx-node（ネイティブアドオン）の読み込み口。
 *
 * 話者分割と声紋抽出の両方が同じモジュールを使うので、CJS の癖とモデルの
 * 存在確認をここ 1 か所にまとめる。WASM 版から乗り換えた経緯は ADR-028。
 */

export interface SherpaExports {
  OfflineSpeakerDiarization: typeof import('sherpa-onnx-node').OfflineSpeakerDiarization
  SpeakerEmbeddingExtractor: typeof import('sherpa-onnx-node').SpeakerEmbeddingExtractor
}

/** import() が返した名前空間。名前付き export はある場合と無い場合がある。 */
export type SherpaNamespace = Partial<SherpaExports> & { default: SherpaExports }

/**
 * sherpa-onnx-node は CJS で `module.exports` を変数から組み立てているため、
 * Node の `import()` は名前付き export を推測できず default にしか入らない。
 * 変換系（vitest 等）では名前付きも生えるので、クラスごとに両方を見る。
 */
export const pickSherpaExports = (namespace: SherpaNamespace): SherpaExports => ({
  OfflineSpeakerDiarization:
    namespace.OfflineSpeakerDiarization ?? namespace.default.OfflineSpeakerDiarization,
  SpeakerEmbeddingExtractor:
    namespace.SpeakerEmbeddingExtractor ?? namespace.default.SpeakerEmbeddingExtractor
})

/**
 * ネイティブライブラリを読む。
 *
 * 呼び出しは実際に推論を走らせるときだけで十分で、アプリの起動時間とメモリを
 * 不必要に使わないため import はここで行う。
 */
export const loadSherpa = async (): Promise<SherpaNamespace> =>
  (await import('sherpa-onnx-node')) as unknown as SherpaNamespace

/**
 * モデルの存在を JS 側で先に確かめる。
 *
 * パスが不正なままネイティブへ渡すと原因の分からないエラーになり、利用者が
 * 何を直せばよいか分からなくなる。欠けていればメッセージを返す（見つかれば undefined）。
 */
export const missingModelMessage = (label: string, path: string): string | undefined =>
  existsSync(path)
    ? undefined
    : `${label}が見つかりません（${path}）。設定画面で取得し直すか、話者識別を無効にしてください。`
