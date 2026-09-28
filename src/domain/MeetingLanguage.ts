/**
 * 会議の言語（ADR-043）。要約・チャットのプロンプト、話者の既定名、メモの見出しを決める。
 *
 * UI の言語とは別物。英語 UI で日本語の会議を録る人もいるため、画面の言語から推さない。
 * プロンプトを用意している言語だけを持つ。
 */
export type MeetingLanguage = 'ja' | 'en'

const MEETING_LANGUAGES: readonly MeetingLanguage[] = ['ja', 'en']

/**
 * 文字起こしの言語設定から会議の言語を決める。
 *
 * `auto` や、whisper は受け付けるがプロンプトを用意していない言語のときは UI の言語に従う。
 * 自動判定の結果を使わないのは、要約だけを再実行したときにも同じ言語で書かせるため
 * （判定結果は保存していない）。
 */
export const meetingLanguageOf = (
  transcriptionLanguage: string,
  fallback: MeetingLanguage
): MeetingLanguage =>
  MEETING_LANGUAGES.find((language) => language === transcriptionLanguage) ?? fallback

/** かな・漢字。これを含む問いは日本語として扱う。 */
const JAPANESE = /[぀-ヿ㐀-鿿]/

/**
 * チャットの問いの言語。
 *
 * チャットは録音をまたいで答えるので、1 つの会議の言語では決められない。利用者が
 * 書いた言語で答えるのが自然で、英語の問いに日本語の指示文を渡すと答えも日本語に寄る。
 */
export const questionLanguageOf = (question: string): MeetingLanguage =>
  JAPANESE.test(question) ? 'ja' : 'en'
