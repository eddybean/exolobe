import { dot, normalize } from '@domain/vector'

/**
 * 声紋（話者の声を表すベクトル）と、それを使った名前の引き当て。
 *
 * 一度名前を付けた相手を、次の録音でも同じ名前で呼べるようにするための計算を
 * ここに閉じる。ベクトルを取り出すのは port の向こう側（sherpa-onnx）の仕事で、
 * ここは受け取った数値だけを見る。
 *
 * 声紋帳に登録されるのは、利用者が明示的に名前を付けたときだけ（ADR-031）。
 * 方針の理由は登録が起きる `RenameSpeaker` に書いてある。
 */

/**
 * 声紋の出所。「どの録音のどの話者に、この名前を付けたか」の 1 件。
 *
 * 平均した結果だけでなく元のベクトルも持つ。名前を付け直したときに、
 * 古い名前からその 1 件ぶんだけを正確に取り消すため（引き算では戻せない）。
 */
export interface VoiceSource {
  /** `<録音 ID>:<話者 ID>`。同じ話者に何度名前を付けても 1 件に保つ鍵。 */
  readonly key: string
  /** 長さ 1 に正規化済み。 */
  readonly vector: Float32Array
}

/** 声紋帳の 1 件。名前がそのまま鍵になる。 */
export interface Voiceprint {
  readonly name: string
  /** 出所の平均を長さ 1 に正規化したもの。類似度は内積だけで求まる。 */
  readonly vector: Float32Array
  /** この名前を付けた話者たち。多いほど 1 件ぶんの影響が小さくなる。 */
  readonly sources: readonly VoiceSource[]
  /** 埋め込みモデルの識別子。変われば過去のベクトルとは比較できない。 */
  readonly modelKey: string
  readonly updatedAt: string
}

/** `RenameSpeaker` が声紋帳に渡す出所の鍵。 */
export const voiceSourceKey = (recordingId: string, speakerId: string): string =>
  `${recordingId}:${speakerId}`

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
  options: { threshold: number; modelKey: string }
): Map<string, string> => {
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
    if (runnerUp && best.score - runnerUp.score < VOICEPRINT_MATCH_MARGIN) continue

    proposals.push({ speakerId, name: best.name, score: best.score })
  }

  // スコアの高い順に確定させるので、既に取られた名前は必ずこちらより似ている。
  const matched = new Map<string, string>()
  const taken = new Set<string>()

  for (const proposal of proposals.sort((a, b) => b.score - a.score)) {
    if (taken.has(proposal.name)) continue
    taken.add(proposal.name)
    matched.set(proposal.speakerId, proposal.name)
  }

  return matched
}

/**
 * 名前とその声を結び付ける。同じ出所を付け直した場合は差し替え、
 * 別の出所なら足して平均を取り直す。
 *
 * モデルが変わっていた場合は過去の出所を捨てて作り直す。別のモデルのベクトルを
 * 混ぜても意味のある値にはならない。
 */
export const registerVoice = (
  existing: Voiceprint | undefined,
  params: { name: string; source: string; vector: Float32Array; modelKey: string; now: Date }
): Voiceprint => {
  const base = existing && existing.modelKey === params.modelKey ? existing : undefined
  const kept = (base?.sources ?? []).filter((source) => source.key !== params.source)

  return build(params.name, [...kept, { key: params.source, vector: params.vector }], {
    modelKey: params.modelKey,
    now: params.now
  })
}

/**
 * 出所を 1 件取り消し、残りで平均を取り直す。最後の 1 件なら声紋ごと消す。
 *
 * 名前を付け直したときに呼ぶ。「田中さん」を「佐藤さん」に直したのに田中さんの
 * 声紋が同じベクトルのまま残ると、次の録音では 1 位と 2 位が同点になり、
 * 「差が無いなら当てにいかない」規則で両方とも弾かれる（＝その人は二度と
 * 自動判定されない）。取り消しまでが訂正の一部。
 */
export const forgetSource = (
  voiceprint: Voiceprint,
  source: string,
  now: Date
): Voiceprint | undefined => {
  const kept = voiceprint.sources.filter((entry) => entry.key !== source)
  if (kept.length === voiceprint.sources.length) return voiceprint
  if (kept.length === 0) return undefined

  return build(voiceprint.name, kept, { modelKey: voiceprint.modelKey, now })
}

const build = (
  name: string,
  sources: readonly VoiceSource[],
  options: { modelKey: string; now: Date }
): Voiceprint => {
  const width = sources.reduce((max, source) => Math.max(max, source.vector.length), 0)
  const mean = new Float32Array(width)
  for (const source of sources) {
    for (let index = 0; index < width; index += 1) {
      mean[index] = (mean[index] ?? 0) + (source.vector[index] ?? 0)
    }
  }

  return {
    name,
    vector: normalize(mean),
    sources,
    modelKey: options.modelKey,
    updatedAt: options.now.toISOString()
  }
}
