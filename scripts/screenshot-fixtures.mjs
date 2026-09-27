/**
 * README のスクリーンショット（docs/images/app-library.png）を撮るための架空データを作る。
 *
 * 本物の会議を画面に映さないため、録音・話者・要約はすべて作り話にしている。
 * 保存先（library）と userData を同じ一時ディレクトリの下に作るので、
 * `--user-data-dir` でそこを指して起動すれば利用者の実データには触れない。
 * 乱数は種を固定しており、何度作っても同じ画面になる。
 *
 * 使い方:
 *   node scripts/screenshot-fixtures.mjs <出力先ディレクトリ>
 *   env -u ELECTRON_RUN_AS_NODE HOME=<出力先> ./node_modules/.bin/electron out/main/index.js \
 *     --remote-debugging-port=9222 --user-data-dir=<出力先>/userData
 * 撮り方は CLAUDE.md の「UI の変更を実機で確かめる」を参照。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const STEPS = ['mix', 'transcribe', 'diarize', 'summarize', 'encode']

/** 種を固定できる乱数（mulberry32）。Math.random では撮り直すたびに発言の帯が変わる。 */
const seededRandom = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const SELF = { id: 'self', kind: 'self', label: '自分' }
const remote = (cluster, label) => ({ id: `remote:${cluster}`, kind: 'remote', label })

const FILLER = [
  'その件はチケットに起こしておきます。',
  '前回の結果と比べると少し改善していますね。',
  'リリースノートの書き方も揃えておきたいです。',
  'そこは次回までに確認しておきます。',
  'ここは優先度を下げても良さそうです。',
  'はい、それで問題ないと思います。',
  '数字を見てから判断しましょう。',
  '担当は私で大丈夫です。',
  '念のためもう一度手順を確認させてください。',
  '期限は来週金曜で良いですか。'
]

const OPENING = [
  ['田中', 12, 'では定例を始めます。今日は次のリリースの範囲と、検証の進め方を決めたいです。'],
  ['自分', 21, 'ありがとうございます。手元の進捗だと、録音まわりの改修は先週で一通り終わっています。'],
  ['佐藤', 31, '検証環境のほうは、macOS 14 と 15 の両方を用意できました。15 は実機、14 は仮想です。'],
  ['鈴木', 42, '14 が仮想だと、音声の取り込みまでは確かめられないですよね。'],
  ['佐藤', 50, 'そこは実機を一台借りる方向で調整します。来週の頭には押さえられる見込みです。'],
  ['自分', 60, '助かります。文字起こしの精度検証は、実際の会議音声を 10 本ほど使って測る予定です。'],
  ['田中', 70, '10 本の内訳は決まっていますか。日本語だけでなく英語混じりのものも入れたいです。'],
  ['自分', 80, '日本語 7 本、英語混じり 3 本で考えています。長さは 30 分から 1 時間のものを選びました。'],
  ['鈴木', 91, '英語混じりは言語自動判定の挙動も一緒に見ておきたいですね。'],
  ['田中', 101, '賛成です。では判定を固定した場合との差も表にまとめてもらえますか。'],
  ['自分', 110, '承知しました。9 月 26 日の定例で共有します。']
]

const MAIN_SUMMARY = `## 概要

次期リリースの範囲と検証の進め方を決める定例。録音まわりの改修は完了しており、
残りは検証環境の確保と文字起こし精度の測定という認識で一致した。

## 決定事項

- リリース目標日は 10 月 3 日
- 検証対象は macOS 14 / 15 の両方。14 は実機を 1 台借りて確認する
- 精度検証は実会議の音声 10 本（日本語 7 本・英語混じり 3 本、各 30〜60 分）で行う
- 要約の品質評価は次回に持ち越す

## ToDo（担当者と期限が分かる場合は併記）

- 佐藤さん: macOS 14 の実機を手配（来週頭まで）
- 自分: 言語自動判定と日本語固定の両方で精度を測り、差分を表にまとめる
- 自分: 検証結果を 9 月 26 日の定例で共有

## 議論の流れ

1. 進捗の共有（録音まわりの改修は完了）
2. 検証環境の確認と、仮想環境の限界
3. 精度検証の音声の内訳
`

/** 再生バーが録音時間どおりの長さで出るよう、無音の m4a を用意する。 */
const writeSilentAudio = (path, durationMs, scratch) => {
  const sampleRate = 8_000
  const samples = Math.round((durationMs / 1_000) * sampleRate)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + samples * 2, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // モノラル
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(samples * 2, 40)
  const wav = join(scratch, 'silence.wav')
  writeFileSync(wav, Buffer.concat([header, Buffer.alloc(samples * 2)]))
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', wav, path])
  rmSync(wav)
}

/** 保存先のディレクトリ名は slugForRecording() と同じく「開始時刻（JST）-id 先頭 8 桁」。 */
const slugFor = (startedAt, id) => {
  const jst = new Date(startedAt.getTime() + 9 * 3_600_000).toISOString()
  return `${jst.slice(0, 10)}_${jst.slice(11, 13)}${jst.slice(14, 16)}-${id.slice(0, 8)}`
}

/**
 * root の下に library（録音の保存先）と userData（設定）を作る。
 * @param {string} root
 */
export const writeScreenshotFixtures = async (root) => {
  const random = seededRandom(7)
  const pick = (items) => items[Math.floor(random() * items.length)]
  const between = (min, max) => min + Math.floor(random() * (max - min + 1))
  const uuid = () =>
    'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => between(0, 15).toString(16))

  const library = join(root, 'library')
  const userData = join(root, 'userData')
  mkdirSync(library, { recursive: true })
  mkdirSync(userData, { recursive: true })

  const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2))
  json(join(userData, 'settings.json'), { schemaVersion: 1, storageDir: library })
  json(join(library, 'folders.json'), [
    { id: 'f-client', name: '取引先' },
    { id: 'f-acme', name: 'Acme 社', parentId: 'f-client' },
    { id: 'f-team', name: '社内定例' }
  ])

  const record = ({ title, startedAt, durationMs, folderId, speakers, segments, summary, audio }) => {
    const id = uuid()
    const slug = slugFor(startedAt, id)
    const dir = join(library, slug)
    mkdirSync(dir)
    json(join(dir, 'meta.json'), {
      schemaVersion: 1,
      id,
      title,
      startedAt: startedAt.toISOString(),
      durationMs,
      status: 'ready',
      steps: Object.fromEntries(STEPS.map((step) => [step, { status: 'done' }])),
      slug,
      ...(folderId === undefined ? {} : { folderId })
    })
    json(join(dir, 'transcript.json'), { schemaVersion: 1, speakers, segments })
    writeFileSync(join(dir, 'summary.md'), summary)
    if (audio) writeSilentAudio(join(dir, 'audio.m4a'), durationMs, root)
  }

  // 画面の主役。4 人の発言が帯に散らばって見えるよう、冒頭の後ろを乱数で埋める。
  const speakerIds = { 自分: 'self', 田中: 'remote:0', 佐藤: 'remote:1', 鈴木: 'remote:2' }
  const mainDuration = (24 * 60 + 22) * 1_000
  const mainSegments = OPENING.map(([who, second, text]) => ({
    startMs: second * 1_000,
    endMs: second * 1_000 + text.length * 230,
    speakerId: speakerIds[who],
    text
  }))
  const turns = [
    ['田中', 4],
    ['自分', 4],
    ['佐藤', 3],
    ['鈴木', 2]
  ]
  const totalWeight = turns.reduce((sum, [, weight]) => sum + weight, 0)
  const weightedSpeaker = () => {
    let r = random() * totalWeight
    for (const [who, weight] of turns) {
      r -= weight
      if (r < 0) return who
    }
    return turns[0][0]
  }
  let previous
  for (let t = 120_000; t < mainDuration - 15_000; ) {
    const who = weightedSpeaker()
    if (who === previous) continue
    previous = who
    const length = between(4_000, 26_000)
    mainSegments.push({ startMs: t, endMs: t + length, speakerId: speakerIds[who], text: pick(FILLER) })
    t += length + between(300, 2_500)
  }

  const alternating = () =>
    Array.from({ length: 20 }, (_, i) => ({
      startMs: 5_000 + i * 9_000,
      endMs: 13_000 + i * 9_000,
      speakerId: i % 2 === 0 ? 'self' : 'remote:0',
      text: pick(FILLER)
    }))
  const two = [SELF, remote('0', '参加者A')]
  const jst = (iso) => new Date(`${iso}+09:00`)

  record({
    title: 'Acme 社 リリース範囲の定例',
    startedAt: jst('2026-09-12T10:00:00'),
    durationMs: mainDuration,
    folderId: 'f-acme',
    speakers: [SELF, remote('0', '田中さん'), remote('1', '佐藤さん'), remote('2', '鈴木さん')],
    segments: mainSegments,
    summary: MAIN_SUMMARY,
    audio: true
  })
  record({
    title: '週次の進捗共有',
    startedAt: jst('2026-09-11T15:00:00'),
    durationMs: 31 * 60_000,
    folderId: 'f-team',
    speakers: two,
    segments: alternating(),
    summary: '## 概要\n\n週次の進捗共有。\n'
  })
  record({
    title: 'Acme 社 キックオフ',
    startedAt: jst('2026-09-05T14:00:00'),
    durationMs: 58 * 60_000,
    folderId: 'f-acme',
    speakers: two,
    segments: alternating(),
    summary: '## 概要\n\nキックオフ。\n'
  })
  record({
    title: '採用面談の振り返り',
    startedAt: jst('2026-09-04T17:30:00'),
    durationMs: 22 * 60_000,
    folderId: 'f-team',
    speakers: two,
    segments: alternating(),
    summary: '## 概要\n\n振り返り。\n'
  })
  // 取り込んだ音声は全体を相手側として扱う（ADR-030）ので、自分の発言は無い。
  record({
    title: '取り込んだ音声（過去のウェビナー）',
    startedAt: jst('2026-09-01T13:00:00'),
    durationMs: 45 * 60_000,
    speakers: [remote('0', '参加者A'), remote('1', '参加者B')],
    segments: Array.from({ length: 20 }, (_, i) => ({
      startMs: 5_000 + i * 9_000,
      endMs: 13_000 + i * 9_000,
      speakerId: `remote:${i % 2}`,
      text: pick(FILLER)
    })),
    summary: '## 概要\n\nウェビナー。\n'
  })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2]
  if (out === undefined) {
    console.error('使い方: node scripts/screenshot-fixtures.mjs <出力先ディレクトリ>')
    process.exit(1)
  }
  await writeScreenshotFixtures(resolve(out))
  console.log(resolve(out))
}
