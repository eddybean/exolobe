import { existsSync } from 'node:fs'
import { toMessage } from '@domain/errors'
import {
  DiarizationError,
  type DiarizationSegment,
  type DiarizationSession,
  type DiarizationSessionFactory
} from './SherpaOnnxDiarizer'

/**
 * sherpa-onnx（WASM ビルド）で話者ダイアライゼーションのセッションを作る。
 *
 * import はメソッド内で行う。数十 MB の WASM を読むのは実際に話者識別を走らせる
 * ときだけで十分で、アプリの起動時間とメモリを不必要に使わないため。
 *
 * モデルの存在確認を JS 側で先に行うのが要点。パスが不正なまま WASM へ渡すと
 * `null function or function signature mismatch` という原因の分からない
 * RuntimeError になり、利用者が何を直せばよいか分からなくなる。
 */
export class SherpaOnnxSessionFactory implements DiarizationSessionFactory {
  async create(config: {
    segmentationModelPath: string
    embeddingModelPath: string
  }): Promise<DiarizationSession> {
    requireModel('話者分割モデル', config.segmentationModelPath)
    requireModel('話者埋め込みモデル', config.embeddingModelPath)

    const sherpa = await load()

    const diarization = sherpa.createOfflineSpeakerDiarization({
      segmentation: { pyannote: { model: config.segmentationModelPath } },
      embedding: { model: config.embeddingModelPath },
      clustering: { numClusters: -1, threshold: 0.5 },
      minDurationOn: 0.3,
      minDurationOff: 0.5
    })

    if (diarization.handle === 0) {
      throw new DiarizationError(
        '話者識別の初期化に失敗しました。設定画面でモデルを取得し直してください。'
      )
    }

    return {
      sampleRate: diarization.sampleRate,
      process: (samples) => processWithHeapGuard(diarization, samples),
      dispose: () => diarization.free()
    }
  }
}

/** wasm ヒープのうち、空きの確認に使う部分だけ。 */
export interface WasmHeap {
  _malloc(bytes: number): number
  _free(pointer: number): void
}

/** sherpa-onnx の JS ラッパのうち、ここで直接触る部分だけ。 */
interface RawDiarization {
  readonly Module?: WasmHeap
  process(samples: Float32Array): DiarizationSegment[]
}

/**
 * 推論の前に、音声ぶんの wasm ヒープが確保できるかを確かめてから sherpa へ渡す。
 *
 * sherpa の `process()` は `_malloc` の戻り値を検査せず、確保に失敗しても 0 番地へ
 * 音声を書き込んで推論を続けてしまう。結果は「memory access out of bounds」という
 * wasm のトラップか、C++ 例外がポインタ値のまま飛んでくる数値だけのエラー
 * （例: 260476136）になり、利用者にも開発者にも原因が分からない。
 * wasm ヒープの上限は 2GB で増やせないため、足りないなら踏み込む前に止める。
 */
export const processWithHeapGuard = (
  diarization: RawDiarization,
  samples: Float32Array
): DiarizationSegment[] => {
  const bytes = samples.length * Float32Array.BYTES_PER_ELEMENT
  const heap = diarization.Module

  if (heap !== undefined) {
    const probe = heap._malloc(bytes)
    if (probe === 0) throw outOfMemory(bytes)
    // sherpa が同じサイズを確保し直す。直前に解放したこの領域がそのまま使われる。
    heap._free(probe)
  }

  try {
    return diarization.process(samples)
  } catch (error: unknown) {
    // 数値は Emscripten が C++ 例外をポインタ値のまま投げたもの。
    if (typeof error === 'number' || isHeapFailure(error)) throw outOfMemory(bytes, error)
    throw error
  }
}

const isHeapFailure = (error: unknown): boolean =>
  error instanceof Error && /out of bounds|out of memory|enlarge memory/i.test(error.message)

const outOfMemory = (bytes: number, cause?: unknown): DiarizationError =>
  new DiarizationError(
    `話者識別に必要なメモリ（約 ${Math.ceil(bytes / 1_048_576)}MB）を確保できませんでした。` +
      '録音が長いほど多く必要です。他のアプリを終了してから再実行するか、' +
      '設定で話者識別を無効にしてください。',
    cause === undefined ? undefined : { cause }
  )

const requireModel = (label: string, path: string): void => {
  if (!existsSync(path)) {
    throw new DiarizationError(
      `${label}が見つかりません（${path}）。設定画面で取得し直すか、話者識別を無効にしてください。`
    )
  }
}

const load = async (): Promise<typeof import('sherpa-onnx')> => {
  try {
    return await import('sherpa-onnx')
  } catch (error: unknown) {
    throw new DiarizationError(
      `sherpa-onnx を読み込めませんでした（${toMessage(error)}）。` +
        '話者識別を無効にすると、自分と参加者の 2 話者で処理を続行できます。',
      { cause: error }
    )
  }
}
