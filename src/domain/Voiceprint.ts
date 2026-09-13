import { dot, normalize } from '@domain/vector'

/**
 * 声紋（話者の声を表すベクトル）と、それを使った名前の引き当て。
 *
 * 一度名前を付けた相手を、次の録音でも同じ名前で呼べるようにするための計算を
 * ここに閉じる。ベクトルを取り出すのは port の向こう側（sherpa-onnx）の仕事で、
 * ここは受け取った数値だけを見る。
 *
 * 声紋帳に登録されるのは、利用者が明示的に名前を付けたときだけ（ADR-031）。
 * 自動で当てた名前をそのまま学習し直すと、一度の誤りが声紋に混ざって次の誤りを
 * 呼ぶ。利用者が「田中さん」を「佐藤さん」に直したなら、そのベクトルは佐藤さんの
 * ものとして登録され、田中さんの声紋は汚れない。
 */

/** 声紋帳の 1 件。名前がそのまま鍵になる。 */
export interface Voiceprint {
  readonly name: string
  /** 長さ 1 に正規化済み。類似度は内積だけで求まる。 */
  readonly vector: Float32Array
  /** 平均に使った回数。多いほど 1 回ぶんの影響が小さくなる。 */
  readonly samples: number
  /** 埋め込みモデルの識別子。変われば過去のベクトルとは比較できない。 */
  readonly modelKey: string
  readonly updatedAt: string
}

/** 1 録音の中の話者 1 人ぶんの声紋。`speakerId` は `remote:spk0` 形式。 */
export interface SpeakerVector {
  readonly speakerId: string
  /** 長さ 1 に正規化済み（`SpeakerEmbeddingPort` の契約）。 */
  readonly vector: Float32Array
}

/**
 * 1 録音ぶんの声紋。
 *
 * どのモデルで作ったかを添える。モデルを入れ替えた後で古い声紋を声紋帳へ
 * 登録すると、比較できない値が混ざったまま気付けない。
 */
export interface RecordingVoices {
  readonly modelKey: string
  readonly speakers: readonly SpeakerVector[]
}

/**
 * 保存されていたベクトルを声紋として受け取れるか。
 *
 * NaN を 1 つでも通すと内積が NaN になり、閾値も 2 位との差も「比較が常に偽」で
 * 素通りしてしまう。壊れたファイルが最も確信度の高い候補として振る舞うため、
 * 読み込み口で弾く。
 */
export const isVoiceVector = (value: unknown): value is readonly number[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((element) => typeof element === 'number' && Number.isFinite(element))

/**
 * 名前を自動で当てにいく下限。
 *
 * 3D-Speaker CampPlus のコサイン類似度で、同一話者は概ね 0.65 以上、別人は 0.5 を
 * 下回る。既定を 0.6 に置いているのは、取りこぼして「参加者A」のままになるほうが、
 * 別人の名前を黙って書き込むより回復しやすいため。設定で変えられる。
 */
export const VOICEPRINT_MATCH_THRESHOLD = 0.6

/**
 * 1 位と 2 位の間に要求する差。
 *
 * 似た声が 2 人登録されていて僅差で競っている状況は、どちらを選んでも半々の賭けに
 * なる。閾値だけで決めると「よく似た同僚 2 人」で恒常的に取り違える。差が無いなら
 * 当てにいかず、利用者の判断に委ねる。
 */
export const VOICEPRINT_MATCH_MARGIN = 0.05

/**
 * 話者クラスタに声紋帳の名前を引き当てる。
 *
 * 返すのは確信の持てた組だけで、当たらなかった話者は入らない（呼び出し側が
 * 「参加者A」の採番に回す）。1 つの名前が複数の話者に当たった場合は、最も似ている
 * 1 人にだけ付ける。同じ会議に同じ人が 2 人いることはないため。
 */
export const matchVoiceprints = (
  vectors: readonly SpeakerVector[],
  registry: readonly Voiceprint[],
  options: { threshold: number; modelKey: string; margin?: number }
): Map<string, string> => {
  const margin = options.margin ?? VOICEPRINT_MATCH_MARGIN
  const candidates = registry.filter((entry) => entry.modelKey === options.modelKey)
  if (candidates.length === 0) return new Map()

  const proposals: { speakerId: string; name: string; score: number }[] = []

  for (const { speakerId, vector } of vectors) {
    const scored = candidates
      .map((entry) => ({ name: entry.name, score: dot(vector, entry.vector) }))
      .sort((a, b) => b.score - a.score)

    const best = scored[0]
    if (!best || best.score < options.threshold) continue

    const runnerUp = scored[1]
    if (runnerUp && best.score - runnerUp.score < margin) continue

    proposals.push({ speakerId, name: best.name, score: best.score })
  }

  const matched = new Map<string, string>()
  const taken = new Map<string, number>()

  for (const proposal of [...proposals].sort((a, b) => b.score - a.score)) {
    if ((taken.get(proposal.name) ?? -Infinity) >= proposal.score) continue
    taken.set(proposal.name, proposal.score)
    matched.set(proposal.speakerId, proposal.name)
  }

  return matched
}

/**
 * 声紋帳の 1 件を作る、または既存の声紋に今回ぶんを平均して混ぜる。
 *
 * 回数で重み付けするので、同じ人に名前を付けるたびに声紋が安定していく。
 * モデルが変わっていた場合は平均せず置き換える。別のモデルのベクトルを足しても
 * 意味のある値にはならない。
 */
export const mergeVoiceprint = (
  existing: Voiceprint | undefined,
  params: { name: string; vector: Float32Array; modelKey: string; now: Date }
): Voiceprint => {
  const base =
    existing && existing.modelKey === params.modelKey ? existing : undefined

  if (!base) {
    return {
      name: params.name,
      vector: normalize(params.vector),
      samples: 1,
      modelKey: params.modelKey,
      updatedAt: params.now.toISOString()
    }
  }

  const weighted = new Float32Array(base.vector.length)
  for (let index = 0; index < weighted.length; index += 1) {
    weighted[index] = (base.vector[index] ?? 0) * base.samples + (params.vector[index] ?? 0)
  }

  return {
    name: params.name,
    vector: normalize(weighted),
    samples: base.samples + 1,
    modelKey: params.modelKey,
    updatedAt: params.now.toISOString()
  }
}
