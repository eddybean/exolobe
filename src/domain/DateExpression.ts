/**
 * 問い文に含まれる日付の言い回しを、録音を絞るための期間に変える純粋な計算。
 *
 * この判断を LLM の tool calling に任せない。4B クラスのモデルは日付の計算を
 * しばしば外し、しかも外したことが出力から見えない（それらしい期間の議事録が
 * 返るだけ）。ここで決めれば、どの録音を見たかを利用者に提示できる。
 */

/** 期間。[fromMs, toMs) の半開区間なので、境界の重複を考えずに済む。 */
export interface DateRange {
  readonly fromMs: number
  readonly toMs: number
}

export interface DateExpressionMatch {
  readonly range: DateRange
  /** 問い文の中で日付語が占めた位置。話題語を作るときに削るため。 */
  readonly spans: readonly { readonly start: number; readonly end: number }[]
  /** 利用者に見せる期間の表記。例「先週（08/31〜09/06）」 */
  readonly label: string
}

/** 「最近」「このところ」が指す日数。 */
export const RECENT_DAYS = 14

/**
 * 以下すべてローカル時刻のメソッドだけで組み立てる。
 *
 * 保存ディレクトリ名がローカル時刻由来（slugForRecording）なのと同じ理由で、
 * 利用者の言う「昨日」は利用者の時計の昨日でなければならない。UTC で計算すると
 * 深夜や早朝の録音が隣の日に滑る。
 */

export const startOfDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate())

export const addDays = (date: Date, days: number): Date => {
  const result = new Date(date.getTime())
  result.setDate(result.getDate() + days)
  return result
}

/** 月初を基準に動かす。月末（31 日）から月を進めたときの繰り上がりを避けるため。 */
export const addMonths = (date: Date, months: number): Date => new Date(date.getFullYear(), date.getMonth() + months, 1)

/**
 * 週の始まりは月曜。
 *
 * 業務の週が月〜金なので「先週の TODO」は月曜からの一週間を指す。日曜始まりだと、
 * 日曜に振り返ったときの「先週」が今週の前半を含んでしまい直感に反する。
 */
export const startOfWeek = (date: Date): Date => addDays(startOfDay(date), -((date.getDay() + 6) % 7))

export const startOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), 1)

const startOfYear = (date: Date): Date => new Date(date.getFullYear(), 0, 1)

const range = (from: Date, to: Date): DateRange => ({ fromMs: from.getTime(), toMs: to.getTime() })

const days = (now: Date, offset: number, count = 1): DateRange => {
  const from = addDays(startOfDay(now), offset)
  return range(from, addDays(from, count))
}

const weeks = (now: Date, offset: number): DateRange => {
  const from = addDays(startOfWeek(now), offset * 7)
  return range(from, addDays(from, 7))
}

const months = (now: Date, offset: number): DateRange => {
  const from = addMonths(startOfMonth(now), offset)
  return range(from, addMonths(from, 1))
}

const years = (now: Date, offset: number): DateRange => {
  const from = new Date(startOfYear(now).getFullYear() + offset, 0, 1)
  return range(from, new Date(from.getFullYear() + 1, 0, 1))
}

/** 今日を含む直近 count 日間。 */
const recent = (now: Date, count: number): DateRange => days(now, -(count - 1), count)

const specificDay = (year: number, month: number, day: number): DateRange => {
  const from = new Date(year, month - 1, day)
  return range(from, addDays(from, 1))
}

const specificMonth = (year: number, month: number): DateRange => {
  const from = new Date(year, month - 1, 1)
  return range(from, addMonths(from, 1))
}

/**
 * 年を言わずに「9月の」と言われたら、今日を過ぎていない限り今年として読む。
 * 未来の会議の記録は存在しないので、未来になるなら前年を指していると考える。
 */
const yearFor = (now: Date, month: number, day: number): number => {
  const thisYear = new Date(now.getFullYear(), month - 1, day)
  return thisYear.getTime() > startOfDay(now).getTime() ? now.getFullYear() - 1 : now.getFullYear()
}

const toInt = (value: string | undefined): number => Number.parseInt(value ?? '', 10)

interface Rule {
  readonly pattern: RegExp
  readonly resolve: (match: RegExpExecArray, now: Date) => DateRange | undefined
}

/**
 * 「先週の月曜」のような複合や曜日単独（「月曜の会議」）は扱わない。
 * 当たらなければ期間で絞らないだけだが、取り違えると別の週の議事録を
 * それらしく返してしまい、利用者が誤りに気づけない。
 */
const RULES: readonly Rule[] = [
  { pattern: /今日|本日/g, resolve: (_m, now) => days(now, 0) },
  { pattern: /一昨日|おととい/g, resolve: (_m, now) => days(now, -2) },
  { pattern: /昨日|きのう/g, resolve: (_m, now) => days(now, -1) },

  { pattern: /先々週|先先週/g, resolve: (_m, now) => weeks(now, -2) },
  { pattern: /先週|前週/g, resolve: (_m, now) => weeks(now, -1) },
  { pattern: /今週/g, resolve: (_m, now) => weeks(now, 0) },

  { pattern: /先々月|先先月/g, resolve: (_m, now) => months(now, -2) },
  { pattern: /先月|前月/g, resolve: (_m, now) => months(now, -1) },
  { pattern: /今月/g, resolve: (_m, now) => months(now, 0) },

  { pattern: /一昨年|おととし/g, resolve: (_m, now) => years(now, -2) },
  { pattern: /去年|昨年/g, resolve: (_m, now) => years(now, -1) },
  { pattern: /今年|本年/g, resolve: (_m, now) => years(now, 0) },

  { pattern: /(\d{1,3})日前/g, resolve: (m, now) => days(now, -toInt(m[1])) },
  { pattern: /(\d{1,2})週間前/g, resolve: (m, now) => weeks(now, -toInt(m[1])) },
  { pattern: /(\d{1,2})[ヶケかカ箇]?月前/g, resolve: (m, now) => months(now, -toInt(m[1])) },

  {
    pattern: /(?:過去|直近|ここ)(\d{1,3})日(?:間)?/g,
    resolve: (m, now) => recent(now, toInt(m[1]))
  },
  {
    pattern: /(?:過去|直近|ここ)(\d{1,2})週間/g,
    resolve: (m, now) => recent(now, toInt(m[1]) * 7)
  },
  { pattern: /最近|このところ/g, resolve: (_m, now) => recent(now, RECENT_DAYS) },

  {
    pattern: /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/g,
    resolve: (m) => specificDay(toInt(m[1]), toInt(m[2]), toInt(m[3]))
  },
  {
    pattern: /(\d{4})[-/年](\d{1,2})月?(?![-/\d])/g,
    resolve: (m) => specificMonth(toInt(m[1]), toInt(m[2]))
  },
  {
    pattern: /(\d{1,2})月(\d{1,2})日/g,
    resolve: (m, now) => {
      const month = toInt(m[1])
      const day = toInt(m[2])
      return specificDay(yearFor(now, month, day), month, day)
    }
  },
  {
    pattern: /(\d{1,2})月(?!\d)/g,
    resolve: (m, now) => {
      const month = toInt(m[1])
      return specificMonth(yearFor(now, month, 1), month)
    }
  }
]

const pad = (value: number): string => String(value).padStart(2, '0')

const formatDay = (date: Date): string => `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`

/** 1 日だけの期間は終端を書かない。「昨日（09/12〜09/12）」は読みにくい。 */
const formatLabel = (text: string, value: DateRange): string => {
  const from = new Date(value.fromMs)
  const last = new Date(value.toMs - 1)
  return formatDay(from) === formatDay(last)
    ? `${text}（${formatDay(from)}）`
    : `${text}（${formatDay(from)}〜${formatDay(last)}）`
}

/**
 * 問い文から期間を 1 つだけ読み取る。
 *
 * 複数当たった場合は最も長い言い回しを採る。「先々週」は「先週」にも部分一致するが、
 * 利用者が長く書いた方が意図に近い。
 */
export const parseDateExpression = (query: string, now: Date): DateExpressionMatch | undefined => {
  let best: { text: string; start: number; value: DateRange } | undefined

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = rule.pattern.exec(query)) !== null) {
      const value = rule.resolve(match, now)
      if (!value) continue
      if (best === undefined || match[0].length > best.text.length) {
        best = { text: match[0], start: match.index, value }
      }
    }
  }

  if (!best) return undefined

  return {
    range: best.value,
    spans: [{ start: best.start, end: best.start + best.text.length }],
    label: formatLabel(best.text, best.value)
  }
}
