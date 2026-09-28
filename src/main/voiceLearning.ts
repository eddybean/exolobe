import type { VoiceExtractionPort } from '@application/ports'
import type { VoiceMemoryResult } from '@application/usecases/library'
import { ConfigurationError } from '@domain/errors'
import { describe } from './i18n'
import type { VoiceLearnedDto } from '@shared/ipc'

export type VoiceLearnedEvent = VoiceLearnedDto

/** 声紋帳への登録だけを行う窓。`RememberSpeakerVoice` がこの形をしている。 */
interface SpeakerVoiceMemory {
  execute(params: {
    recordingId: string
    speakerId: string
    label: string
  }): Promise<VoiceMemoryResult>
}

export interface VoiceLearning {
  /** 受け取ってすぐ返る。結果は `notify` で後から届く。 */
  enqueue(params: { recordingId: string; speakerId: string; label: string }): void
  /** 列が空になるまで待つ。終了時の後始末とテスト用。 */
  settled(): Promise<void>
}

/**
 * 話者に付けた名前を、裏で 1 件ずつ声紋帳へ覚えさせる。
 *
 * 名前の反映（transcript.json の書き換え）は即座に終わるが、声紋がまだ無い録音では
 * 音声の変換と声紋の抽出で数十秒かかる。利用者を入力欄の前で待たせないため、
 * リネームの応答とは切り離してここに積む。
 *
 * 1 件ずつ直列に流すのが要点で、理由は 2 つある。voiceprints.json の更新が
 * 読んで書き戻す形なので、並行させると片方の登録が消える。そして声紋の取り直しは
 * 1 件目が voices.json を書いた時点で済み、2 人目以降はそれを読むだけになる ——
 * 続けて名前を付けても重い処理は 1 回で終わる。
 */
export const createVoiceLearning = (deps: {
  remember: SpeakerVoiceMemory
  notify: (event: VoiceLearnedEvent) => void
}): VoiceLearning => {
  let queue: Promise<void> = Promise.resolve()

  return {
    enqueue(params): void {
      queue = queue.then(async () => {
        try {
          const status = await deps.remember.execute(params)
          deps.notify({ ...params, status })
        } catch (error: unknown) {
          // 1 件の失敗で列を止めない。次の話者は覚えられるかもしれない。
          deps.notify({ ...params, status: 'failed', message: describe(error) })
        }
      })
    },
    async settled(): Promise<void> {
      await queue
    }
  }
}

/**
 * 声紋の取り直しをパイプラインのワーカーへ投げる窓。
 *
 * ワーカーを持つ `PipelineClient` は IPC の登録時に作られ、依存の結線
 * （container.ts）より後になる。実体は後から差し込む。
 */
export class WorkerVoiceExtraction implements VoiceExtractionPort {
  private delegate: ((recordingId: string) => Promise<void>) | undefined

  use(delegate: (recordingId: string) => Promise<void>): void {
    this.delegate = delegate
  }

  async extract(recordingId: string): Promise<void> {
    if (!this.delegate) {
      throw new ConfigurationError({ code: 'voiceLearningUnavailable' })
    }
    await this.delegate(recordingId)
  }
}
