/**
 * 要約 (summary.md) を表示するための、依存を持たない小さな Markdown パーサ。
 *
 * 外部ライブラリを足さないのは、このアプリが「ローカル完結・依存は最小」を通しているのと、
 * HTML を組み立てずに木を返すことで `dangerouslySetInnerHTML` を使わずに済むため。
 * 危険なリンクはここで落とすので、描画側は木をそのまま信じてよい。
 *
 * 対応するのは要約で実際に出てくる記法だけ（見出し・リスト・強調・コード・水平線・表・リンク）。
 * CommonMark の完全な実装ではない。
 */

export type Align = 'left' | 'center' | 'right'

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong'; readonly children: readonly Inline[] }
  | { readonly kind: 'em'; readonly children: readonly Inline[] }
  | { readonly kind: 'strike'; readonly children: readonly Inline[] }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly Inline[] }

export interface ListItem {
  readonly content: readonly Inline[]
  readonly nested: readonly Block[]
}

export type Block =
  | { readonly kind: 'heading'; readonly level: number; readonly children: readonly Inline[] }
  | { readonly kind: 'paragraph'; readonly children: readonly Inline[] }
  | { readonly kind: 'rule' }
  | { readonly kind: 'code'; readonly lang: string; readonly text: string }
  | {
      readonly kind: 'list'
      readonly ordered: boolean
      readonly start: number
      readonly items: readonly ListItem[]
    }
  | {
      readonly kind: 'table'
      readonly align: readonly (Align | null)[]
      readonly head: readonly (readonly Inline[])[]
      readonly rows: readonly (readonly (readonly Inline[])[])[]
    }

const HEADING = /^(#{1,6})\s+(.*)$/
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/
const FENCE = /^\s{0,3}(```+|~~~+)\s*(\S*)\s*$/
const BULLET = /^(\s*)([-*+])\s+(.*)$/
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/
const TABLE_DELIMITER = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*(?::?-+:?\s*)?$/

/** アプリ内遷移や任意コード実行に化けないスキームだけを通す。 */
const SAFE_SCHEME = /^(?:https?:|mailto:)/i

/** 表の 1 行を、外周のパイプを落としてセルへ割る。 */
const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())

/** 区切り行のコロンから寄せを読む。指定が無ければ null。 */
const alignOf = (cell: string): Align | null => {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return 'center'
  if (left) return 'left'
  if (right) return 'right'
  return null
}

/** 行頭の空白を、タブを 4 桁として数える。 */
const indentWidth = (spaces: string): number => [...spaces].reduce((width, char) => width + (char === '\t' ? 4 : 1), 0)

interface ListLine {
  readonly indent: number
  readonly ordered: boolean
  readonly number: number
  readonly text: string
}

/** リスト項目の行なら、その中身を取り出す。 */
const asListLine = (line: string): ListLine | null => {
  const bullet = BULLET.exec(line)
  if (bullet) {
    return {
      indent: indentWidth(bullet[1] ?? ''),
      ordered: false,
      number: 1,
      text: bullet[3] ?? ''
    }
  }

  const ordered = ORDERED.exec(line)
  if (ordered) {
    return {
      indent: indentWidth(ordered[1] ?? ''),
      ordered: true,
      number: Number(ordered[2] ?? '1'),
      text: ordered[3] ?? ''
    }
  }

  return null
}

/**
 * 同じ深さの項目を 1 つのリストにまとめ、より深い行は入れ子として再帰的に畳む。
 * 戻り値は消費した行数。
 */
const takeList = (lines: readonly ListLine[], from: number, indent: number): [Block, number] => {
  const first = lines[from] as ListLine
  const items: ListItem[] = []
  let at = from

  while (at < lines.length) {
    const line = lines[at] as ListLine
    if (line.indent < indent || line.ordered !== first.ordered) break

    at += 1
    const nested: Block[] = []
    while (at < lines.length && (lines[at] as ListLine).indent > line.indent) {
      const [child, next] = takeList(lines, at, (lines[at] as ListLine).indent)
      nested.push(child)
      at = next
    }

    items.push({ content: parseInline(line.text), nested })
  }

  return [{ kind: 'list', ordered: first.ordered, start: first.number, items }, at]
}

/** Markdown 文字列を、描画に必要な最小限の木へ変換する。 */
export const parseMarkdown = (source: string): Block[] => {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let at = 0

  while (at < lines.length) {
    const line = lines[at] as string

    if (line.trim().length === 0) {
      at += 1
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const marker = (fence[1] ?? '```')[0] as string
      const body: string[] = []
      at += 1
      // 閉じが無いまま終わるのは LLM の出力では珍しくないので、末尾までを中身とする。
      while (at < lines.length && !new RegExp(`^\\s{0,3}${marker}{3,}\\s*$`).test(lines[at] as string)) {
        body.push(lines[at] as string)
        at += 1
      }
      const closed = at < lines.length
      at += 1
      // 閉じ忘れのときは最後まで飲み込むので、文書末尾の空行までコードに混ぜない。
      if (!closed) while (body.length > 0 && (body[body.length - 1] as string).trim() === '') body.pop()
      blocks.push({ kind: 'code', lang: fence[2] ?? '', text: body.join('\n') })
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      at += 1
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        children: parseInline(heading[2] ?? '')
      })
      at += 1
      continue
    }

    const next = lines[at + 1]
    if (line.includes('|') && next !== undefined && TABLE_DELIMITER.test(next)) {
      const align = splitRow(next).map(alignOf)
      const head = splitRow(line).map(parseInline)
      const rows: Inline[][][] = []
      at += 2
      while (at < lines.length && (lines[at] as string).includes('|')) {
        rows.push(splitRow(lines[at] as string).map(parseInline))
        at += 1
      }
      blocks.push({ kind: 'table', align, head, rows })
      continue
    }

    if (asListLine(line) !== null) {
      const listLines: ListLine[] = []
      while (at < lines.length) {
        const item = asListLine(lines[at] as string)
        if (item === null) break
        listLines.push(item)
        at += 1
      }
      let cursor = 0
      while (cursor < listLines.length) {
        const [block, after] = takeList(listLines, cursor, (listLines[cursor] as ListLine).indent)
        blocks.push(block)
        cursor = after
      }
      continue
    }

    // 段落。空行か、他のブロックが始まるまでを 1 つにまとめる。
    const paragraph: string[] = []
    while (at < lines.length) {
      const current = lines[at] as string
      if (current.trim().length === 0) break
      if (RULE.test(current) || HEADING.test(current) || FENCE.test(current)) break
      if (paragraph.length > 0 && asListLine(current) !== null) break
      paragraph.push(current.trim())
      at += 1
    }
    blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join('\n')) })
  }

  return blocks
}

/** 区切り記号を、対応する閉じ記号の位置まで含めて 1 つのノードにする指定。 */
const WRAPPERS: readonly { readonly open: string; readonly kind: 'strong' | 'em' | 'strike' }[] = [
  { open: '**', kind: 'strong' },
  { open: '__', kind: 'strong' },
  { open: '~~', kind: 'strike' },
  { open: '*', kind: 'em' },
  { open: '_', kind: 'em' }
]

/** 直前の文字が確定したテキストとして溜まっているものを吐き出す。 */
const flush = (buffer: string[], out: Inline[]): void => {
  if (buffer.length === 0) return
  out.push({ kind: 'text', text: buffer.join('') })
  buffer.length = 0
}

/** 行内の記法を解釈する。閉じ記号が無い開始記号は、ただの文字として残す。 */
export const parseInline = (source: string): Inline[] => {
  const out: Inline[] = []
  const buffer: string[] = []
  let at = 0

  while (at < source.length) {
    const char = source[at] as string

    if (char === '\\' && at + 1 < source.length) {
      buffer.push(source[at + 1] as string)
      at += 2
      continue
    }

    if (char === '`') {
      const end = source.indexOf('`', at + 1)
      if (end > at) {
        flush(buffer, out)
        out.push({ kind: 'code', text: source.slice(at + 1, end) })
        at = end + 1
        continue
      }
    }

    // 画像は表示しない方針（CSP が外部取得を塞いでいる）ので alt だけ残す。
    if (char === '!' && source[at + 1] === '[') {
      const link = matchLink(source, at + 1)
      if (link !== null) {
        buffer.push(link.label)
        at = link.end
        continue
      }
    }

    if (char === '[') {
      const link = matchLink(source, at)
      if (link !== null) {
        flush(buffer, out)
        // 危険なスキームはここで落とす。描画側で href を検査しなくて済む。
        if (SAFE_SCHEME.test(link.href)) {
          out.push({ kind: 'link', href: link.href, children: parseInline(link.label) })
        } else {
          out.push(...parseInline(link.label))
        }
        at = link.end
        continue
      }
    }

    const wrapper = WRAPPERS.find((candidate) => source.startsWith(candidate.open, at))
    if (wrapper) {
      const end = source.indexOf(wrapper.open, at + wrapper.open.length)
      const inner = end > at ? source.slice(at + wrapper.open.length, end) : ''
      // 記号のあいだが空（`2 * 3 * です` の類）なら強調ではなく掛け算などの文字。
      if (end > at && inner.trim().length > 0 && !inner.startsWith(' ') && !inner.endsWith(' ')) {
        flush(buffer, out)
        out.push({ kind: wrapper.kind, children: parseInline(inner) })
        at = end + wrapper.open.length
        continue
      }
    }

    buffer.push(char)
    at += 1
  }

  flush(buffer, out)
  return out
}

/** `[表示](URL)` を位置から読み取る。 */
const matchLink = (
  source: string,
  at: number
): { readonly label: string; readonly href: string; readonly end: number } | null => {
  const labelEnd = source.indexOf(']', at + 1)
  if (labelEnd < 0 || source[labelEnd + 1] !== '(') return null

  // `javascript:alert(1)` のように URL 内に括弧があるため、対応を取って閉じを探す。
  let depth = 0
  let hrefEnd = -1
  for (let at = labelEnd + 2; at < source.length; at += 1) {
    const char = source[at]
    if (char === '(') depth += 1
    else if (char === ')') {
      if (depth === 0) {
        hrefEnd = at
        break
      }
      depth -= 1
    }
  }
  if (hrefEnd < 0) return null

  return {
    label: source.slice(at + 1, labelEnd),
    href: source.slice(labelEnd + 2, hrefEnd).trim(),
    end: hrefEnd + 1
  }
}
