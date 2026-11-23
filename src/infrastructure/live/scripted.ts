import type {
  LiveAssistModelPort,
  LiveTranscriptionEvent,
  LiveTranscriptionPort,
  PastRecordingHit,
  PastRecordingSearchPort
} from '@application/ports'
import type { CaptionTrack } from '@domain/LiveCaption'

/**
 * 開発中に画面を確かめるための、台本どおりに動く録音中のアシスト（ADR-050）。
 * `OMR_LIVE_ASSIST_FAKE=1` を付けて開発版を起動したときだけ使う（配布版では効かない）。
 * 音声の許可も会議も無しに、字幕・カード・見出し・ボタンの見た目を確かめられる。
 */

const SCRIPT: readonly { track: CaptionTrack; text: string }[] = [
  { track: 'remote', text: 'それでは定例を始めます。' },
  { track: 'remote', text: 'まず先週話していたログイン画面のバグの件ですが、原因はセッションの有効期限の計算でした。' },
  { track: 'self', text: '了解です。ステージングで確認できたら連絡します。' },
  { track: 'remote', text: '次に、来月のリリースの日程について相談させてください。' },
  { track: 'remote', text: '決済まわりのテストが終わっていないので、二十二日に後ろ倒しにしたいと考えています。' },
  { track: 'self', text: '二十二日で問題ありません。営業チームには私から連絡しておきます。' },
  { track: 'remote', text: '最後に、今朝のクラウドの障害の影響範囲を確認しておいてもらえますか。' },
  { track: 'self', text: 'わかりました。午後までに調べて共有します。' }
]

/** 台本の 1 文を書きかけで少しずつ見せ、確定させる。実物の字幕の出方に近づける。 */
export class ScriptedLiveTranscriber implements LiveTranscriptionPort {
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly stepMs = 400) {}

  async start(params: { onEvent: (event: LiveTranscriptionEvent) => void }): Promise<void> {
    params.onEvent({ type: 'ready' })
    let line = 0
    let shown = 0
    let elapsedMs = 0
    let lineStartMs = 0
    this.timer = setInterval(() => {
      const entry = SCRIPT[line % SCRIPT.length]
      if (!entry) return
      elapsedMs += this.stepMs
      shown += 4
      const done = shown >= entry.text.length
      params.onEvent({
        type: 'caption',
        caption: {
          track: entry.track,
          kind: done ? 'final' : 'volatile',
          text: done ? entry.text : entry.text.slice(0, shown),
          startMs: lineStartMs,
          endMs: elapsedMs
        }
      })
      if (done) {
        line += 1
        shown = 0
        lineStartMs = elapsedMs
      }
    }, this.stepMs)
  }

  push(): void {}

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
}

/** プロンプトの種類を見て、決まった形の応答を返す。 */
export class ScriptedLiveAssistModel implements LiveAssistModelPort {
  async respond(prompt: string): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 800))
    const english = prompt.includes('Headline:') || prompt.includes('TODO:') || prompt.includes('Summarize')
    if (prompt.includes('見出し:') || prompt.includes('Headline:')) {
      return english
        ? 'Headline: Release date moved\n- Shipping on the 22nd\n- I will tell the sales team'
        : '見出し: リリース日程の後ろ倒し\n- 決済のテスト待ちで 22 日に\n- 営業へは自分が連絡'
    }
    if (prompt.includes('ToDo:') || prompt.includes('TODO:')) {
      return english
        ? 'TODO: Tell the sales team (me)\nTODO: Check the outage impact (me)\nDECISION: Ship on the 22nd'
        : 'ToDo: 営業チームに連絡する（自分）\nToDo: 障害の影響範囲を調べて共有する（自分）\n決定: リリースは 22 日に後ろ倒し'
    }
    return english
      ? '- The login bug was a session expiry miscalculation\n- Release moves to the 22nd\n- Outage impact to be shared this afternoon'
      : '- ログイン画面のバグはセッションの期限の計算が原因\n- リリースは 22 日に後ろ倒し\n- 障害の影響範囲は午後までに共有'
  }
}

/** 最新の録音を、話題語に当たったものとして返す。 */
export class ScriptedPastRecordingSearch implements PastRecordingSearchPort {
  constructor(private readonly latest: () => Promise<PastRecordingHit | undefined>) {}

  async search(): Promise<readonly PastRecordingHit[]> {
    const hit = await this.latest()
    return hit ? [hit] : []
  }
}
