/**
 * 文字起こしの評価。`npm run eval:transcription` でだけ走る。
 *
 * 合成した会議音声をアプリと同じ WhisperCppTranscriber で起こし、正解と突き合わせた
 * 指標を基準（baseline.json）と並べる。施策の前後で良くなったか悪くなったかを見るためのもの。
 * 合否は出さない — 数値の読み方は施策ごとに違い、機械的な閾値で判定できない。
 *
 * CI と npm test から外してあるのは、モデル（574MB）と whisper-cli と macOS の `say` が
 * 要り、声が macOS の版で変わって数値が環境ごとに揺れるため。
 *
 * 環境変数:
 * - OMR_EVAL_UPDATE_BASELINE=1 … 今回の結果で baseline.json を書き換える
 * - OMR_EVAL_MODEL_DIR … モデルの置き場所（既定はアプリの models ディレクトリ）
 * - OMR_EVAL_WHISPER_CLI … whisper-cli のパス（既定は同梱版、無ければ PATH）
 * - OMR_EVAL_EXTRA_DIR … 手元の録音で評価する。`<名前>.wav` と、正解の
 *   `<名前>.json`（`{ "said": [{ "startMs", "endMs", "text" }] }`）を置く。
 *   本文を含むので結果は基準に書かず、リポジトリの外に置いたまま使う。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, release } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { findAsset } from '@domain/ModelCatalog'
import { int16Buffer, readWav, WavFileWriter } from '@infrastructure/audio/wav'
import { WhisperCppTranscriber, type DropReason } from '@infrastructure/transcription/WhisperCppTranscriber'
import { composeScenario, SAMPLE_RATE, type Utterance } from './compose'
import { characterErrorRate, hallucinatedChars, longestRepeatRun, missedUtterances } from './metrics'
import {
  environmentDifferences,
  formatComparison,
  type CaseResult,
  type EvalEnvironment,
  type EvalReport
} from './report'
import { SCENARIOS, VOICES } from './scenarios'

const HERE = resolve('tests/eval/transcription')
const CACHE = join(HERE, '.cache')
const BASELINE = join(HERE, 'baseline.json')

/**
 * 合成音声は macOS の say で作るので、macOS でだけ使う。Windows では手元の録音（OMR_EVAL_EXTRA_DIR）だけで測り、
 * 基準（baseline.json、macOS の合成音声の結果）は取り直さない（ADR-048）。
 */
const macOS = process.platform === 'darwin'

/** アプリがモデルを置く場所（userData/models）。 */
const defaultModelDir = macOS
  ? join(homedir(), 'Library', 'Application Support', 'Exolobe', 'models')
  : join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Exolobe', 'models')
const modelDir = process.env.OMR_EVAL_MODEL_DIR ?? defaultModelDir
const modelFile = findAsset('transcription-model')?.fileName ?? ''
const vadFile = findAsset('vad-model')?.fileName ?? ''
const bundledCli = resolve(macOS ? 'resources/bin/whisper-cli' : 'resources/bin/whisper-cli.exe')
const whisperCli = process.env.OMR_EVAL_WHISPER_CLI ?? (existsSync(bundledCli) ? bundledCli : 'whisper-cli')

const hash = (value: string): string => createHash('sha1').update(value).digest('hex').slice(0, 12)

const readEnvironment = (): EvalEnvironment => {
  // 基準と同じ項目名（macos）のまま、Windows では OS と版を入れる。食い違えば基準と条件が違うと表に出る。
  const macos = macOS
    ? execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim()
    : `${process.platform} ${release()}`
  // --version はモデルを読まずに版だけを stderr に出す。
  const versionOutput = (() => {
    try {
      return execFileSync(whisperCli, ['--version'], { encoding: 'utf8', stdio: 'pipe' })
    } catch (error: unknown) {
      const stderr = (error as { stderr?: unknown }).stderr
      return typeof stderr === 'string' ? stderr : ''
    }
  })()
  const whisper = /whisper\.cpp version:\s*(\S+)/.exec(versionOutput)?.[1] ?? 'unknown'
  return { macos, whisper, model: modelFile, voices: [...VOICES] }
}

const assertPrerequisites = (): void => {
  for (const file of [modelFile, vadFile]) {
    if (!existsSync(join(modelDir, file))) {
      throw new Error(
        `${join(modelDir, file)} がありません。アプリでモデルを取得するか OMR_EVAL_MODEL_DIR を指定してください。`
      )
    }
  }
  if (!macOS) {
    if (process.env.OMR_EVAL_EXTRA_DIR === undefined) {
      throw new Error('macOS 以外では合成音声を作れません。OMR_EVAL_EXTRA_DIR に録音と正解を置いてください。')
    }
    return
  }
  const installed = execFileSync('say', ['-v', '?'], { encoding: 'utf8' })
  const missing = VOICES.filter((voice) => !installed.includes(voice))
  if (missing.length > 0) {
    throw new Error(
      `say の声がありません: ${missing.join(', ')}。システム設定の読み上げコンテンツから追加してください。`
    )
  }
}

const speechKey = (text: string, voice: string): string => `${voice}\n${text}`

/**
 * 台本が使う文をすべて say で読み上げ、16kHz モノラルにして読み込む。
 * 同じ文と声はファイルを使い回す。組み立て（composeScenario）は同期なので先に済ませる。
 */
const prepareSpeech = async (environment: EvalEnvironment): Promise<(text: string, voice: string) => Float32Array> => {
  const dir = join(CACHE, 'tts')
  mkdirSync(dir, { recursive: true })
  const voices = new Map<string, Float32Array>()
  const collect = (text: string, voice: string): Float32Array => {
    voices.set(speechKey(text, voice), new Float32Array(0))
    return new Float32Array(0)
  }
  for (const scenario of SCENARIOS) composeScenario(scenario.parts, collect)

  for (const key of voices.keys()) {
    const [voice = '', text = ''] = key.split('\n')
    // 声は macOS の版で変わるので、版ごとに読み直す。
    const file = join(dir, `${hash(key + environment.macos)}`)
    if (!existsSync(`${file}.wav`)) {
      execFileSync('say', ['-v', voice, '-o', `${file}.aiff`, text])
      execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${SAMPLE_RATE}`, '-c', '1', `${file}.aiff`, `${file}.wav`])
    }
    const { samples } = await readWav(`${file}.wav`)
    voices.set(
      key,
      Float32Array.from(samples, (sample) => sample / 32_768)
    )
  }

  return (text, voice) => voices.get(speechKey(text, voice)) ?? new Float32Array(0)
}

const writeWav = async (path: string, samples: Float32Array): Promise<void> => {
  const writer = await WavFileWriter.create(path, { sampleRate: SAMPLE_RATE })
  await writer.write(int16Buffer(Array.from(samples, (sample) => sample * 32_767)))
  await writer.close()
}

interface EvalInput {
  readonly name: string
  readonly wavPath: string
  readonly said: readonly Utterance[]
}

const syntheticInputs = async (environment: EvalEnvironment): Promise<EvalInput[]> => {
  const dir = join(CACHE, 'audio')
  mkdirSync(dir, { recursive: true })
  const speak = await prepareSpeech(environment)
  const inputs: EvalInput[] = []
  for (const scenario of SCENARIOS) {
    const { samples, said } = composeScenario(scenario.parts, speak)
    // 声は macOS の版で変わるので、版ごとに作り直す。
    const wavPath = join(dir, `${scenario.name}-${hash(JSON.stringify(scenario.parts) + environment.macos)}.wav`)
    if (!existsSync(wavPath)) await writeWav(wavPath, samples)
    inputs.push({ name: scenario.name, wavPath, said })
  }
  return inputs
}

const extraInputs = (dir: string | undefined): EvalInput[] =>
  dir === undefined
    ? []
    : readdirSync(dir)
        .filter((file) => file.endsWith('.wav'))
        .map((file) => {
          const name = basename(file, '.wav')
          const reference = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as {
            said: Utterance[]
          }
          // 文字起こしは WAV の隣に同じ名前の .json を書いてから消すので、そのままだと正解の <名前>.json を
          // 上書きして消してしまう。キャッシュに写したものを渡す。
          const copied = join(CACHE, 'extra', file)
          mkdirSync(dirname(copied), { recursive: true })
          copyFileSync(join(dir, file), copied)
          return { name: `extra:${name}`, wavPath: copied, said: reference.said }
        })

const evaluate = async (input: EvalInput, config: CaseResult['config']): Promise<CaseResult> => {
  const started = Date.now()
  const dropped: Record<DropReason, number> = {
    'non-speech': 0,
    boilerplate: 0,
    'low-confidence': 0,
    repetition: 0
  }
  const transcriber = new WhisperCppTranscriber({
    binaryPath: whisperCli,
    modelPath: join(modelDir, modelFile),
    ...(config === 'vad' ? { vadModelPath: join(modelDir, vadFile) } : {}),
    glossary: [],
    onDropped: (segment) => {
      dropped[segment.reason] += 1
    }
  })
  const output = await transcriber.transcribe({
    wavPath: input.wavPath,
    language: 'ja',
    speakerId: 'remote'
  })
  // 速さは表（基準との差）に入れない。機体や GPU で大きく変わり、施策の良し悪しと混ざるため。
  const audioSeconds = input.said.at(-1)?.endMs ?? 0
  console.log(
    `${input.name} ${config}: ${((Date.now() - started) / 1000).toFixed(1)} 秒（音声 ${(audioSeconds / 1000).toFixed(0)} 秒まで）`
  )

  return {
    scenario: input.name,
    config,
    cer: characterErrorRate(
      input.said.map((utterance) => utterance.text).join(''),
      output.map((segment) => segment.text).join('')
    ),
    hallucinatedChars: hallucinatedChars(input.said, output),
    missedUtterances: missedUtterances(input.said, output),
    utterances: input.said.length,
    longestRepeatRun: longestRepeatRun(output),
    dropped
  }
}

it('合成音声を文字起こしして基準と比べる', async () => {
  assertPrerequisites()
  const environment = readEnvironment()
  const synthetic = macOS ? await syntheticInputs(environment) : []
  const extra = extraInputs(process.env.OMR_EVAL_EXTRA_DIR)

  const results: CaseResult[] = []
  for (const input of [...synthetic, ...extra]) {
    for (const config of ['vad', 'no-vad'] as const) {
      results.push(await evaluate(input, config))
    }
  }

  const baseline = existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as EvalReport) : undefined
  const differences = baseline ? environmentDifferences(environment, baseline.environment) : []
  const report = [
    `whisper-cli: ${whisperCli}`,
    `environment: ${JSON.stringify(environment)}`,
    ...(baseline ? [] : ['基準（baseline.json）がありません。']),
    ...(differences.length > 0
      ? ['**基準と条件が違うので、差は施策の効果とは限りません:**', ...differences.map((d) => `- ${d}`)]
      : []),
    '',
    formatComparison(results, baseline?.results)
  ].join('\n')

  mkdirSync(CACHE, { recursive: true })
  writeFileSync(join(CACHE, 'report.md'), `${report}\n`)
  console.log(`\n${report}\n\n(${join(CACHE, 'report.md')} にも書き出した)`)

  if (process.env.OMR_EVAL_UPDATE_BASELINE === '1' && macOS) {
    // 手元の録音（extra）は本文の手掛かりになる名前を含みうるので、基準には入れない。
    const next: EvalReport = {
      environment,
      results: results.filter((result) => !result.scenario.startsWith('extra:'))
    }
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`${BASELINE} を更新した`)
  }

  expect(results.length).toBeGreaterThan(0)
})
