/**
 * 評価に使う台本。ハルシネーションや繰り返しが起きやすい形を 1 本ずつ受け持つ。
 *
 * 台本を変えると基準（baseline.json）と比べられなくなる。変えたら基準を取り直す。
 */
import type { Noise, ScenarioPart } from './compose'

const KYOKO = 'Kyoko'
const EDDY = 'Eddy (日本語（日本）)'
const FLO = 'Flo (日本語（日本）)'
const REED = 'Reed (日本語（日本）)'

/** 台本が使う声。評価の前に、手元の macOS にあるかを確かめる。 */
export const VOICES = [KYOKO, EDDY, FLO, REED] as const

const LINES = [
  'それでは定例を始めます。まず先週の進捗から確認させてください。',
  'はい、ログイン画面の改修は予定どおり終わりました。レビューも済んでいます。',
  'ありがとうございます。検索機能のほうはどうでしょうか。',
  '検索はインデックスの作り直しに時間がかかっていて、あと二日ほど見てほしいです。',
  'わかりました。では木曜までに状況を共有してもらえますか。',
  'はい、木曜の午前中に共有します。',
  '次に来月のリリース計画ですが、ベータ版の配布先を三社に絞る案が出ています。',
  '三社に絞る理由は、サポートの体制が追いつかないからですね。',
  'そうです。問い合わせの窓口を一本化してから広げたいと考えています。',
  '了解です。では配布先の候補は営業から出してもらいましょう。'
] as const

const BACKCHANNEL = 'はい。はい。そうですね。はい。'

const line = (index: number): string => LINES[index] ?? ''
const fan = (level: number): Noise => ({ type: 'fan', level })

export interface Scenario {
  readonly name: string
  /** 何を確かめるための台本か。結果を読むときの手がかり。 */
  readonly purpose: string
  readonly parts: readonly ScenarioPart[]
}

/** 発言の間に雑音だけの長い間。無音区間の定型句と、VAD 無しでのループを誘う。 */
const meeting: Scenario = {
  name: 'meeting',
  purpose: '発言の間に雑音だけの長い間がある会議',
  parts: LINES.flatMap((text, i): ScenarioPart[] => [
    { kind: 'speech', text, voice: [KYOKO, EDDY, FLO][i % 3] ?? KYOKO, noise: fan(0.01) },
    {
      kind: 'gap',
      seconds: [8, 25, 4, 40, 6, 30, 5, 20, 10, 35][i] ?? 10,
      noise: fan(i % 2 ? 0.03 : 0.015)
    }
  ])
}

/** 相づちの連続。本物の繰り返しを消していないか、ループを誘っていないか。 */
const backchannel: Scenario = {
  name: 'backchannel',
  purpose: '相づちの連続と雑音',
  parts: LINES.slice(0, 6).flatMap((text): ScenarioPart[] => [
    { kind: 'speech', text, voice: EDDY, noise: fan(0.01) },
    ...Array.from({ length: 3 }, (): ScenarioPart[] => [
      { kind: 'speech', text: BACKCHANNEL, voice: KYOKO, noise: fan(0.02) },
      { kind: 'gap', seconds: 3, noise: fan(0.03) }
    ]).flat(),
    { kind: 'gap', seconds: 20, noise: fan(0.04) }
  ])
}

/** 声の重なりと小声。本物の小さな発話を拾えているか。 */
const crosstalk: Scenario = {
  name: 'crosstalk',
  purpose: '2 人の声の重なりと小声',
  parts: [0, 2, 4, 6, 8].flatMap((i): ScenarioPart[] => [
    { kind: 'speech', text: line(i), voice: KYOKO, noise: fan(0.01) },
    { kind: 'gap', seconds: 5, noise: fan(0.02) },
    {
      kind: 'overlap',
      main: { text: line(i + 1), voice: REED },
      under: { text: line(i), voice: KYOKO, gain: 0.5, delaySeconds: 1.5 },
      noise: fan(0.02)
    },
    { kind: 'gap', seconds: 15, noise: fan(0.03) },
    { kind: 'speech', text: line(i + 1), voice: REED, gain: 0.08, noise: fan(0.02) },
    { kind: 'gap', seconds: 25, noise: fan(0.03) }
  ])
}

/** 大きな雑音。VAD が雑音を発話と取り違える状況。 */
const noisy: Scenario = {
  name: 'noisy',
  purpose: '空調と打鍵の大きな雑音、電源のうなり',
  parts: LINES.flatMap((text, i): ScenarioPart[] => [
    { kind: 'speech', text, voice: [FLO, EDDY][i % 2] ?? FLO, noise: fan(0.05) },
    { kind: 'gap', seconds: 12, noise: { type: 'keyboard', level: 0.25 } },
    { kind: 'gap', seconds: 8, noise: { type: 'hum', level: 0.05 } },
    { kind: 'gap', seconds: 6, noise: fan(0.08) }
  ])
}

/** BGM。whisper は音楽に字幕の定型句や「♪」を付けやすい。 */
const music: Scenario = {
  name: 'music',
  purpose: '発言の間と下に BGM が流れる',
  parts: LINES.flatMap((text, i): ScenarioPart[] => [
    {
      kind: 'speech',
      text,
      voice: [KYOKO, REED][i % 2] ?? KYOKO,
      noise: i % 3 === 0 ? { type: 'music', level: 0.05 } : fan(0.01)
    },
    { kind: 'gap', seconds: 15, noise: { type: 'music', level: i % 2 ? 0.1 : 0.04 } }
  ])
}

export const SCENARIOS: readonly Scenario[] = [meeting, backchannel, crosstalk, noisy, music]
