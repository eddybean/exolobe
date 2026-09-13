/**
 * ベクトルの基本演算。
 *
 * 意味検索の埋め込みと話者の声紋という、性質の違う 2 つが同じ計算を必要とする。
 * どちらかの語彙（チャンク、話者）に寄せた場所へ置くともう一方が借りに行く形になり、
 * 依存の向きが読めなくなるため、語彙を持たないここに置く。
 */

/**
 * 長さ 1 に揃える。揃えておけば類似度は内積だけで求まる。
 * ゼロベクトルは NaN を生まないようそのまま返す。
 */
export const normalize = (vector: ArrayLike<number>): Float32Array => {
  const result = Float32Array.from(vector)
  let sum = 0
  for (const value of result) sum += value * value
  const length = Math.sqrt(sum)
  if (length === 0) return result

  for (let index = 0; index < result.length; index += 1) {
    result[index] = (result[index] ?? 0) / length
  }
  return result
}

export const dot = (a: Float32Array, b: Float32Array): number => {
  let sum = 0
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index += 1) sum += (a[index] ?? 0) * (b[index] ?? 0)
  return sum
}
