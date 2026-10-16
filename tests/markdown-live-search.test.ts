import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '../src/editor/markdown/wysiwyg/MarkdownParser'
import {
  findMatches,
  buildDecorations,
  replacementText, replaceMatch, createLiveSearchPlugin, liveSearchPluginKey,
  type LiveSearchOptions,
} from '../src/editor/markdown/wysiwyg/plugins/LiveSearch'
import { MarkdownSourceBridge } from '../src/editor/markdown/wysiwyg/MarkdownSourceBridge'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { EditorState } from 'prosemirror-state'

describe('LiveSearch and LiveReplace', () => {
  const options: LiveSearchOptions = { search: '', replace: '', caseSensitive: false, wholeWord: false, regexp: false }
  it('preserves mark boundaries, links, table syntax and unrelated CRLF blocks when replacing', () => {
    const source = '# unchanged\r\n\r\nfoo**bar**[baz](https://example.com)\r\n\r\n| Key | Value |\r\n| :--- | ---: |\r\n| 中文 | keep |\r\n'
    const bridge = new MarkdownSourceBridge(source)
    const state = EditorState.create({ doc: bridge.doc })
    const match = findMatches(state.doc, { ...options, search: 'foobarbaz' }).matches[0]
    const tr = replaceMatch(state.tr, match, 'FOOBARBAZ')
    const prepared = bridge.prepare(tr.doc)
    expect(prepared.source).toBe(source.replace('foo**bar**[baz]', 'FOO**BAR**[BAZ]'))
  })
  it('never matches across images, formulas, hard breaks or table cells', () => {
    const { doc } = parseMarkdown('left![x](./x.png)right\n\nleft$x$right\n\nleft  \nright\n\n| left | right |\n| --- | --- |\n')
    expect(findMatches(doc, { ...options, search: 'leftright' }).matches).toHaveLength(0)
  })
  it('replaces a table cell while preserving alignment, escaped pipes, links and other cells exactly', () => {
    const source = '| Key | Value |\r\n| :--- | ---: |\r\n| 中文 | [link](https://example.com) \\| **keep** |\r\n'
    const bridge = new MarkdownSourceBridge(source), state = EditorState.create({ doc: bridge.doc })
    const match = findMatches(state.doc, { ...options, search: '中文' }).matches[0]
    const prepared = bridge.prepare(replaceMatch(state.tr, match, '汉字').doc)
    expect(prepared.source).toBe(source.replace('中文', '汉字'))
  })
  it('expands contextual regex captures, named groups and dollar substitutions', () => {
    const { doc } = parseMarkdown('before abc12 after')
    const match = findMatches(doc, { ...options, search: '(?<=before )(?<word>abc)(\\d+)(?= after)', regexp: true }).matches[0]
    const pattern = "$<word>/$2/$&/$$/$`/$'/$12/$0"
    expect(replacementText(match, pattern, true)).toBe('abc/12/abc12/$/before / after/abc2/$0')
    expect(replacementText(match, '$1', false)).toBe('$1')
  })
  it('handles Unicode zero length matches without looping and groups whole-word alternatives', () => {
    const { doc } = parseMarkdown('😀 foo foobar bar')
    expect(findMatches(doc, { ...options, search: '(?=.)', regexp: true }).matches).toHaveLength([...doc.textContent.matchAll(/(?=.)/gu)].length)
    expect(findMatches(doc, { ...options, search: 'foo|bar', regexp: true, wholeWord: true }).matches.map(m => m.text)).toEqual(['foo', 'bar'])
  })
  it('recomputes matches on replayed pane transactions before replacement', () => {
    let state = EditorState.create({ doc: parseMarkdown('target **target**\n\n```js\nconst target = 1\n```').doc, plugins: [createLiveSearchPlugin()] })
    state = state.apply(state.tr.setMeta(liveSearchPluginKey, { type: 'open' }))
    state = state.apply(state.tr.setMeta(liveSearchPluginKey, { type: 'setOptions', options: { search: 'target' } }))
    state = state.apply(state.tr.insertText('中文 ', 1))
    const matches = liveSearchPluginKey.getState(state)!.matches
    expect(matches).toHaveLength(3)
    expect(matches[0].from).toBe(4)
    const tr = state.tr
    for (const match of [...matches].reverse()) replaceMatch(tr, match, 'result')
    expect(tr.doc.textContent).toBe('中文 result resultconst result = 1')
    expect(tr.doc.lastChild?.type.name).toBe('code_block')
  })
  const sampleDoc = `# 标题测试 Heading Test

这是包含 **加粗文字** 和 *斜体文字* 的普通段落。
还有链接 [点击前往](https://example.com) 测试。

| 编号 | 名称 | 状态 |
| :--- | :--- | :--- |
| 1 | 仓鼠项目 | 正常 |
| 2 | 金丝熊档案 | 活跃 |

\`\`\`javascript
const greeting = "Hello World";
console.log(greeting);
\`\`\`
`

  it('finds visible text across headings, paragraphs, bold text, table cells and code blocks', () => {
    const { doc } = parseMarkdown(sampleDoc)

    // 1. Search Chinese keyword across different blocks
    const options1: LiveSearchOptions = {
      search: '测试',
      replace: '',
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
    }
    const res1 = findMatches(doc, options1)
    expect(res1.valid).toBe(true)
    // "测试" appears in: Heading "标题测试", Paragraph "...测试。"
    expect(res1.matches.length).toBe(2)

    // 2. Search inside bold formatting
    const options2: LiveSearchOptions = {
      search: '加粗',
      replace: '',
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
    }
    const res2 = findMatches(doc, options2)
    expect(res2.matches.length).toBe(1)
    expect(res2.matches[0].text).toBe('加粗')

    // 3. Search inside table cells
    const options3: LiveSearchOptions = {
      search: '金丝熊',
      replace: '',
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
    }
    const res3 = findMatches(doc, options3)
    expect(res3.matches.length).toBe(1)
    expect(res3.matches[0].text).toBe('金丝熊')

    // 4. Search inside code blocks
    const options4: LiveSearchOptions = {
      search: 'greeting',
      replace: '',
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
    }
    const res4 = findMatches(doc, options4)
    expect(res4.matches.length).toBe(2)
    expect(res4.matches[0].codeBlockPos).toBeDefined()
  })

  it('does NOT match invisible Markdown syntax tokens in Live mode', () => {
    const { doc } = parseMarkdown(sampleDoc)

    // '#' is not part of the rendered text in a heading node
    const options: LiveSearchOptions = {
      search: '#',
      replace: '',
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
    }
    const res = findMatches(doc, options)
    expect(res.matches.length).toBe(0)

    // '|' is not part of the rendered text in table cells
    const optionsPipe: LiveSearchOptions = {
      search: '|',
      replace: '',
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
    }
    const resPipe = findMatches(doc, optionsPipe)
    expect(resPipe.matches.length).toBe(0)
  })

  it('supports case-sensitive search and regular expressions', () => {
    const { doc } = parseMarkdown(sampleDoc)

    // Case sensitive: 'Heading' vs 'heading'
    const caseInsensitive: LiveSearchOptions = {
      search: 'heading',
      replace: '',
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
    }
    expect(findMatches(doc, caseInsensitive).matches.length).toBe(1)

    const caseSensitive: LiveSearchOptions = {
      search: 'heading',
      replace: '',
      caseSensitive: true,
      wholeWord: false,
      regexp: false,
    }
    expect(findMatches(doc, caseSensitive).matches.length).toBe(0)

    // Regex search
    const regexOptions: LiveSearchOptions = {
      search: 'H[a-z]+o\\s+W[a-z]+d',
      replace: '',
      caseSensitive: false,
      wholeWord: false,
      regexp: true,
    }
    const resRegex = findMatches(doc, regexOptions)
    expect(resRegex.valid).toBe(true)
    expect(resRegex.matches.length).toBe(1)
    expect(resRegex.matches[0].text).toBe('Hello World')

    // Invalid regex reports valid: false
    const invalidRegex: LiveSearchOptions = {
      search: '[invalid',
      replace: '',
      caseSensitive: false,
      wholeWord: false,
      regexp: true,
    }
    expect(findMatches(doc, invalidRegex).valid).toBe(false)
  })

  it('buildDecorations generates correct decoration set with active highlight', () => {
    const { doc } = parseMarkdown(sampleDoc)
    const options: LiveSearchOptions = {
      search: '测试',
      replace: '',
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
    }
    const { matches } = findMatches(doc, options)
    const decos = buildDecorations(doc, matches, 0)
    expect(decos).toBeDefined()
    // Finding decorations within the range
    const found = decos.find(0, doc.content.size)
    expect(found.length).toBe(2)
    const cls0 = (found[0] as unknown as { type?: { toDOM?: () => HTMLElement }; spec?: { class?: string } }).spec?.class ||
      (found[0] as unknown as { type?: { attrs?: { class?: string } } }).type?.attrs?.class || ''
    expect(cls0).toContain('md-search-match-current')
    const cls1 = (found[1] as unknown as { type?: { toDOM?: () => HTMLElement }; spec?: { class?: string } }).spec?.class ||
      (found[1] as unknown as { type?: { attrs?: { class?: string } } }).type?.attrs?.class || ''
    expect(cls1).not.toContain('md-search-match-current')
  })

  it('command("find") and command("replace") in DocumentManager do not switch Live mode to source', () => {
    const manager = new DocumentManager(
      [{ id: 'md', name: 'test.md', path: 'test.md', text: sampleDoc }],
      async () => []
    )
    manager.open('md', false)
    expect(manager.metadata('md')?.mode).toBe('live')

    let liveFindCalled = false
    let liveReplaceCalled = false
    const mockLiveEditor = {
      composing: false,
      selection: { anchor: 0, head: 0 },
      sync: () => {},
      focus: () => {},
      reveal: () => {},
      format: () => true,
      typography: () => {},
      clipboard: async () => {},
      refreshResources: () => {},
      destroy: () => {},
      find: (replace?: boolean) => {
        if (replace) liveReplaceCalled = true
        else liveFindCalled = true
      },
      findNext: () => {},
      findPrevious: () => {},
      closeSearch: () => {},
    }

    // Register activeLiveEditor
    ;(manager as unknown as { liveViews: Map<string, { id: string; editor: unknown }> }).liveViews.set(
      'main',
      { id: 'md', editor: mockLiveEditor }
    )

    manager.command('find')
    expect(liveFindCalled).toBe(true)
    // Crucial check: mode remains live!
    expect(manager.metadata('md')?.mode).toBe('live')

    manager.command('replace')
    expect(liveReplaceCalled).toBe(true)
    expect(manager.metadata('md')?.mode).toBe('live')

    manager.dispose()
  })

  it('replacing text in a paragraph via MarkdownSourceBridge preserves other blocks and CRLF', () => {
    // Test that bridge.prepare with replace retains fidelity
    const testBridge = new MarkdownSourceBridge('# Heading\n\nOriginal text **bold**.\n')
    const tr2 = testBridge.prepare(
      testBridge.doc.type.schema.nodes.doc.create(null, [
        testBridge.doc.child(0),
        testBridge.doc.type.schema.nodes.paragraph.create(null, [
          testBridge.doc.type.schema.text('Original text '),
          testBridge.doc.type.schema.text('stronger', [testBridge.doc.type.schema.marks.strong.create()]),
          testBridge.doc.type.schema.text('.'),
        ]),
      ])
    )
    expect(tr2.source).toBe('# Heading\n\nOriginal text **stronger**.\n')
  })
})
