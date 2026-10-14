import { describe, it, expect } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { buildLiveDecorationsForState, livePreviewExtension } from '../src/editor/markdown/livePreview'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { undo } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import { safeMarkdownURL } from '../src/editor/markdown/links'

describe('Markdown Live Preview Core (Phase 5)', () => {
  it('formats H1-H6 and nested emphasis, and reveals Setext underline while editing it', () => {
    const text='outside\n'+Array.from({length:6},(_,i)=>'#'.repeat(i+1)+' Heading').join('\n')+'\n\nTitle\n=====\n\n***nested*** ~~gone~~'
    let state=EditorState.create({doc:text,extensions:[markdown({extensions:[GFM]})]})
    ensureSyntaxTree(state,state.doc.length,1000);state=state.update({}).state
    const classes:string[]=[]
    buildLiveDecorationsForState(state).between(0,text.length,(_from,_to,value)=>{classes.push(value.spec.class||'')})
    for(let i=1;i<=6;i++)expect(classes.some(cls=>cls.includes(`cm-md-h${i}`))).toBe(true)
    expect(classes).toContain('cm-md-strikethrough');expect(classes).toContain('cm-md-strong');expect(classes).toContain('cm-md-emphasis')
    const underline=text.indexOf('=====');state=state.update({selection:{anchor:underline+1}}).state
    let hidden=false
    buildLiveDecorationsForState(state).between(underline,underline+5,(_from,_to,value)=>{if(value.spec.class==='cm-md-mark-hidden')hidden=true})
    expect(hidden).toBe(false)
  })
  it('rejects unsafe web destinations and removes live mode after a file type rename', () => {
    for (const url of ['javascript:alert(1)', 'file:///secret', 'https://user:password@example.com', 'data:text/html,x']) expect(safeMarkdownURL(url)).toBeNull()
    expect(safeMarkdownURL('https://example.com/a')).toBe('https://example.com/a')
    const manager = new DocumentManager([{ id: 'md', name: 'doc.md', path: 'doc.md', text: '**source**' }])
    manager.open('md', false)
    manager.renamePath('doc.md', 'doc.txt', 'doc.txt')
    expect(manager.metadata('md')?.mode).toBeUndefined()
    manager.setDefaultMarkdownMode('source')
    manager.renamePath('doc.txt', 'doc.md', 'doc.md')
    expect(manager.metadata('md')?.mode).toBe('source')
    manager.dispose()
  })
  it('reveals active task syntax and uses the full inline-code delimiter width', () => {
    const text = 'outside\n- [ ] task\n``code ` inside``\n'
    const state = EditorState.create({ doc: text, selection: { anchor: text.indexOf('[ ]') + 1 }, extensions: [markdown({ extensions: [GFM] })] })
    const decorations = buildLiveDecorationsForState(state)
    let taskWidget = false, codeStart = -1
    decorations.between(0, text.length, (from, _to, value) => {
      if (value.spec.widget?.constructor.name === 'CheckboxWidget') taskWidget = true
      if (value.spec.class === 'cm-md-inline-code') codeStart = from
    })
    expect(taskWidget).toBe(false)
    expect(codeStart).toBe(text.indexOf('``') + 2)
  })

  it('decorates only visible quote lines and renders ordered/unordered list markers', () => {
    const text = 'outside\n' + Array.from({ length: 1000 }, () => '> quote').join('\n') + '\n- item\n1. item\n'
    let state = EditorState.create({ doc: text, extensions: [markdown({ extensions: [GFM] })] })
    expect(ensureSyntaxTree(state, state.doc.length, 1000)).not.toBeNull()
    state = state.update({}).state
    const decorations = buildLiveDecorationsForState(state, [{ from: state.doc.line(500).from, to: state.doc.line(501).to }])
    expect(decorations.size).toBeLessThan(12)
    expect(decorations.size).toBeGreaterThan(0)
    const all = buildLiveDecorationsForState(state)
    let foundList = false
    all.between(0, text.length, (_from, _to, value) => { if (value.spec.class?.includes('cm-md-list')) foundList = true })
    expect(foundList).toBe(true)
  })
  it('applies live decorations for headings, strong, italic, code, task list and links', () => {
    const text = `# Heading 1
**bold text** and *italic text* and \`inline code\`
- [ ] task one
- [x] task done
> blockquote line
---
[LightEdit](https://github.com/pucj0/lightEdit)
`
    const state = EditorState.create({
      doc: text,
      extensions: [markdown({ extensions: [GFM] }), livePreviewExtension()],
    })

    const decos = buildLiveDecorationsForState(state, [{ from: 0, to: text.length }])
    expect(decos.size).toBeGreaterThan(0)

    let foundHeading = false
    let foundStrong = false
    let foundItalic = false
    let foundCode = false
    let foundTask = false
    let foundHr = false
    let foundLink = false

    decos.between(0, text.length, (_from, _to, value) => {
      const cls = value.spec.class || ''
      if (cls.includes('cm-md-h1')) foundHeading = true
      if (cls.includes('cm-md-strong')) foundStrong = true
      if (cls.includes('cm-md-emphasis')) foundItalic = true
      if (cls.includes('cm-md-inline-code')) foundCode = true
      if (value.spec.widget?.constructor.name === 'CheckboxWidget') foundTask = true
      if (value.spec.widget?.constructor.name === 'HorizontalRuleWidget') foundHr = true
      if (cls.includes('cm-md-link')) foundLink = true
    })

    expect(foundHeading).toBe(true)
    expect(foundStrong).toBe(true)
    expect(foundItalic).toBe(true)
    expect(foundCode).toBe(true)
    expect(foundTask).toBe(true)
    expect(foundHr).toBe(true)
    expect(foundLink).toBe(true)
  })

  it('reveals markdown source syntax when cursor moves inside formatted range, and collapses when cursor leaves', () => {
    const text = `Normal text **bold** more text`
    const baseExtensions = [markdown({ extensions: [GFM] }), livePreviewExtension()]

    const boldStart = text.indexOf('**bold**')
    const boldMiddle = boldStart + 4 // 光标在 "bold" 内部

    // 1. 光标在开头 (pos 0)：光标不在粗体内部
    const stateAtStart = EditorState.create({
      doc: text,
      selection: { anchor: 0 },
      extensions: baseExtensions,
    })
    const decosAtStart = buildLiveDecorationsForState(stateAtStart)
    let hasHiddenMark = false
    decosAtStart.between(0, text.length, (_from, _to, value) => {
      if (value.spec.class?.includes('cm-md-mark-hidden')) {
        hasHiddenMark = true
      }
    })
    expect(hasHiddenMark).toBe(true) // 标记应该被隐藏以展示即时排版

    // 2. 光标移入粗体内部 (pos boldMiddle)
    const stateInBold = EditorState.create({
      doc: text,
      selection: { anchor: boldMiddle },
      extensions: baseExtensions,
    })
    const decosInBold = buildLiveDecorationsForState(stateInBold)
    let boldMarkHiddenWhileActive = false
    decosInBold.between(boldStart, boldStart + 8, (_from, _to, value) => {
      if (value.spec.class?.includes('cm-md-mark-hidden')) {
        boldMarkHiddenWhileActive = true
      }
    })
    // 光标在粗体内时，粗体标记不应当被隐藏，必须展开供编辑！
    expect(boldMarkHiddenWhileActive).toBe(false)

    // 3. 光标离开粗体 (pos text.length)
    const stateAtEnd = EditorState.create({
      doc: text,
      selection: { anchor: text.length },
      extensions: baseExtensions,
    })
    const decosAtEnd = buildLiveDecorationsForState(stateAtEnd)
    let boldMarkHiddenAgain = false
    decosAtEnd.between(boldStart, boldStart + 8, (_from, _to, value) => {
      if (value.spec.class?.includes('cm-md-mark-hidden')) {
        boldMarkHiddenAgain = true
      }
    })
    expect(boldMarkHiddenAgain).toBe(true) // 离开后重新折叠
  })

  it('checkbox click modifies raw markdown text via Transaction ([ ] <-> [x]) and supports undo', () => {
    const text = `- [ ] Pending item\n- [x] Finished item`
    const manager = new DocumentManager([
      { id: 'task-doc', name: 'todo.md', path: 'todo.md', text },
    ])
    manager.open('task-doc', false)

    // 模拟将第一行 [ ] 勾选为 [x]
    manager.dispatch('task-doc', {
      changes: { from: 2, to: 5, insert: '[x]' },
    })

    expect(manager.getText('task-doc')).toBe(`- [x] Pending item\n- [x] Finished item`)
    expect(manager.metadata('task-doc')?.dirty).toBe(true)

    // 执行 Undo 撤销回 [ ]
    undo({
      state: manager.getState('task-doc')!,
      dispatch: tr => manager.dispatch('task-doc', tr),
    })
    expect(manager.getText('task-doc')).toBe(text)
    expect(manager.metadata('task-doc')?.dirty).toBe(false)

    manager.dispose()
  })

  it('switching between Live, Source and Split views retains text, selection, dirty flag and undo stack without corruption', () => {
    const initialText = `# Markdown Document\n\n**Bold Statement**`
    const manager = new DocumentManager([
      { id: 'modes-doc', name: 'notes.md', path: 'notes.md', text: initialText },
    ])
    manager.open('modes-doc', false)

    expect(manager.metadata('modes-doc')?.mode).toBe('live')

    // 编辑文档产生修改
    const id = 'modes-doc'
    manager.dispatch(id, {
      changes: { from: initialText.length, insert: '\n\nAdditional text edited in live mode.' },
      selection: { anchor: 10 },
    })
    expect(manager.metadata(id)?.dirty).toBe(true)
    const modifiedText = manager.getText(id)!

    // 1. 切换到 Source 模式
    expect(manager.setMarkdownMode(id, 'source')).toBe(true)
    expect(manager.metadata(id)?.mode).toBe('source')
    expect(manager.getText(id)).toBe(modifiedText)
    expect(manager.metadata(id)?.dirty).toBe(true)

    // 2. 切换到 Split 模式
    expect(manager.setMarkdownMode(id, 'split')).toBe(true)
    expect(manager.metadata(id)?.mode).toBe('split')
    expect(manager.getText(id)).toBe(modifiedText)

    // 3. 切回 Live 模式
    expect(manager.setMarkdownMode(id, 'live')).toBe(true)
    expect(manager.metadata(id)?.mode).toBe('live')
    expect(manager.getText(id)).toBe(modifiedText)

    // 4. 在多次模式切换后，进行编辑，再进行撤销，验证历史栈保全且未被重置
    manager.dispatch(id, { changes: { from: 0, insert: 'temporary-step ' } })
    expect(manager.getText(id)).toContain('temporary-step')

    undo({
      state: manager.getState(id)!,
      dispatch: tr => manager.dispatch(id, tr),
    })

    expect(manager.getText(id)).toBe(modifiedText)
    manager.dispose()
  })

  it('non-markdown files strictly disallow markdown live mode', () => {
    const manager = new DocumentManager([
      { id: 'rs-doc', name: 'main.rs', path: 'src/main.rs', text: 'fn main() {}' },
    ])
    manager.open('rs-doc', false)

    expect(manager.metadata('rs-doc')?.language).toBe('Rust')
    expect(manager.metadata('rs-doc')?.mode).toBeUndefined()

    // 尝试切换 Markdown 模式，应当被拒绝返回 false
    expect(manager.setMarkdownMode('rs-doc', 'live')).toBe(false)
    expect(manager.metadata('rs-doc')?.mode).toBeUndefined()

    manager.dispose()
  })

  it('reveals all selected syntax with multiple cursors and preserves complex fallback source', () => {
    const text = 'outside\n**first**\n*second*\n\n```js\n**literal**\n```\n\n| **cell** | other |\n| --- | --- |\n'
    const state = EditorState.create({ doc: text, selection: EditorSelection.create([EditorSelection.cursor(text.indexOf('first')), EditorSelection.cursor(text.indexOf('second'))]), extensions: [EditorState.allowMultipleSelections.of(true), markdown({ extensions: [GFM] })] })
    const decorations = buildLiveDecorationsForState(state)
    let hidden = false
    decorations.between(0, text.length, (_from, _to, value) => { if (value.spec.class === 'cm-md-mark-hidden') hidden = true })
    expect(hidden).toBe(false)
    expect(state.doc.toString()).toBe(text)
  })
})
