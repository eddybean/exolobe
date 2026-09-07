import { describe, expect, it } from 'vitest'
import { parseMarkdown, type Block, type Inline } from '../../src/renderer/markdown/parse'

/**
 * 要約ペインは summary.md をそのまま表示していたため `##` や `-` が生で見えていた。
 * 外部ライブラリを足さずに描画するため、ここで対応記法を明示的に固定する。
 * パース結果が安全な木であること（危険なリンクを載せない）もここで守る。
 */

/** 期待値を書きやすくするための素のテキストノード。 */
const text = (value: string): Inline => ({ kind: 'text', text: value })

/** ブロックを 1 つだけ期待するケース用。 */
const only = (source: string): Block => {
  const blocks = parseMarkdown(source)
  expect(blocks).toHaveLength(1)
  return blocks[0] as Block
}

describe('parseMarkdown のブロック解析', () => {
  it('空文字列は空の配列になる', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('   \n\n  ')).toEqual([])
  })

  it('ATX 見出しを見出しレベルつきで返す', () => {
    expect(only('## 決定事項')).toEqual({
      kind: 'heading',
      level: 2,
      children: [text('決定事項')]
    })
    expect(only('###### 深い見出し')).toMatchObject({ kind: 'heading', level: 6 })
  })

  it('7 個以上の # は見出しではなく段落として扱う', () => {
    expect(only('####### みっつ')).toMatchObject({ kind: 'paragraph' })
  })

  it('段落は連続行をまとめ、行内の改行を残す', () => {
    // 改行を潰すと、これまで pre-wrap で見えていた要約の見た目が崩れる。
    expect(only('一行目\n二行目')).toEqual({
      kind: 'paragraph',
      children: [text('一行目\n二行目')]
    })
  })

  it('空行で段落が分かれる', () => {
    expect(parseMarkdown('前\n\n後')).toEqual([
      { kind: 'paragraph', children: [text('前')] },
      { kind: 'paragraph', children: [text('後')] }
    ])
  })

  it('水平線を認識する', () => {
    expect(only('---')).toEqual({ kind: 'rule' })
    expect(only('***')).toEqual({ kind: 'rule' })
    expect(only('___')).toEqual({ kind: 'rule' })
  })

  it('- * + のいずれでも箇条書きになる', () => {
    for (const marker of ['-', '*', '+']) {
      expect(only(`${marker} ひとつ\n${marker} ふたつ`)).toEqual({
        kind: 'list',
        ordered: false,
        start: 1,
        items: [
          { content: [text('ひとつ')], nested: [] },
          { content: [text('ふたつ')], nested: [] }
        ]
      })
    }
  })

  it('番号付きリストは開始番号を保つ', () => {
    expect(only('3. みっつ目から\n4. よっつ目')).toEqual({
      kind: 'list',
      ordered: true,
      start: 3,
      items: [
        { content: [text('みっつ目から')], nested: [] },
        { content: [text('よっつ目')], nested: [] }
      ]
    })
  })

  it('インデントした項目を入れ子のリストにする', () => {
    expect(only('- 親\n  - 子\n- 次の親')).toEqual({
      kind: 'list',
      ordered: false,
      start: 1,
      items: [
        {
          content: [text('親')],
          nested: [
            {
              kind: 'list',
              ordered: false,
              start: 1,
              items: [{ content: [text('子')], nested: [] }]
            }
          ]
        },
        { content: [text('次の親')], nested: [] }
      ]
    })
  })

  it('リストの直前に空行が無くても段落と切り離す', () => {
    // LLM の出力は見出しや文の直後に空行を挟まないことがある。
    expect(parseMarkdown('決まったこと:\n- ひとつ')).toEqual([
      { kind: 'paragraph', children: [text('決まったこと:')] },
      {
        kind: 'list',
        ordered: false,
        start: 1,
        items: [{ content: [text('ひとつ')], nested: [] }]
      }
    ])
  })

  it('フェンスコードは言語を拾い、中身を一切解釈しない', () => {
    expect(only('```ts\nconst a = **1**\n```')).toEqual({
      kind: 'code',
      lang: 'ts',
      text: 'const a = **1**'
    })
  })

  it('~~~ のフェンスも扱い、閉じが無ければ末尾までをコードとする', () => {
    expect(only('~~~\n- これはリストではない\n')).toEqual({
      kind: 'code',
      lang: '',
      text: '- これはリストではない'
    })
  })

  it('GFM の表を見出し行・寄せ・本文行に分ける', () => {
    expect(only('| 担当 | 期限 |\n| :--- | ---: |\n| 佐藤 | 明日 |')).toEqual({
      kind: 'table',
      align: ['left', 'right'],
      head: [[text('担当')], [text('期限')]],
      rows: [[[text('佐藤')], [text('明日')]]]
    })
  })

  it('中央寄せと寄せ指定なしを区別する', () => {
    const table = only('| a | b |\n| :-: | --- |\n| 1 | 2 |')

    expect(table).toMatchObject({ align: ['center', null] })
  })

  it('区切り行が無ければ表にしない', () => {
    expect(only('| a | b |')).toMatchObject({ kind: 'paragraph' })
  })
})

describe('parseMarkdown のインライン解析', () => {
  const inlineOf = (source: string): readonly Inline[] => {
    const block = only(source)
    if (block.kind !== 'paragraph') throw new Error('段落ではありません')
    return block.children
  }

  it('** と __ を強調にする', () => {
    expect(inlineOf('**太字**と__これも__')).toEqual([
      { kind: 'strong', children: [text('太字')] },
      text('と'),
      { kind: 'strong', children: [text('これも')] }
    ])
  })

  it('* と _ を斜体にする', () => {
    expect(inlineOf('*斜体*')).toEqual([{ kind: 'em', children: [text('斜体')] }])
    expect(inlineOf('_斜体_')).toEqual([{ kind: 'em', children: [text('斜体')] }])
  })

  it('~~ を取り消し線にする', () => {
    expect(inlineOf('~~取り消し~~')).toEqual([{ kind: 'strike', children: [text('取り消し')] }])
  })

  it('強調の中の記法も解釈する', () => {
    expect(inlineOf('**太い`コード`**')).toEqual([
      { kind: 'strong', children: [text('太い'), { kind: 'code', text: 'コード' }] }
    ])
  })

  it('インラインコードの中は記法として解釈しない', () => {
    expect(inlineOf('`**そのまま**`')).toEqual([{ kind: 'code', text: '**そのまま**' }])
  })

  it('閉じられていない記号はただの文字として残す', () => {
    expect(inlineOf('2 * 3 * です')).toEqual([text('2 * 3 * です')])
    expect(inlineOf('**閉じ忘れ')).toEqual([text('**閉じ忘れ')])
  })

  it('バックスラッシュでエスケープした記号は文字になる', () => {
    expect(inlineOf('\\*星\\*')).toEqual([text('*星*')])
  })

  it('リンクを href つきで返す', () => {
    expect(inlineOf('詳細は [議事録](https://example.com/a) を参照')).toEqual([
      text('詳細は '),
      { kind: 'link', href: 'https://example.com/a', children: [text('議事録')] },
      text(' を参照')
    ])
  })

  it('mailto も許可する', () => {
    expect(inlineOf('[連絡](mailto:a@example.com)')).toMatchObject([
      { kind: 'link', href: 'mailto:a@example.com' }
    ])
  })

  it('http/https/mailto 以外のリンクは木に載せず表示文字に落とす', () => {
    // 木の時点で安全にしておけば、描画側が href を検査しなくてよい。
    for (const href of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd']) {
      expect(inlineOf(`[危険](${href})`)).toEqual([text('危険')])
    }
  })

  it('画像はスコープ外なので alt テキストとして扱う', () => {
    expect(inlineOf('![図](https://example.com/a.png)')).toEqual([text('図')])
  })

  it('見出しやリストの中でもインライン記法が効く', () => {
    expect(only('# **重要**')).toMatchObject({
      kind: 'heading',
      children: [{ kind: 'strong' }]
    })
  })
})
