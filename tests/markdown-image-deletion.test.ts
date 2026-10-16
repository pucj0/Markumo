import { describe, it, expect } from 'vitest'
import { EditorState, TextSelection, NodeSelection } from 'prosemirror-state'
import { baseKeymap } from 'prosemirror-commands'
import { markdownSchema as s } from '../src/editor/markdown/wysiwyg/MarkdownSchema'
import { MarkdownSourceBridge } from '../src/editor/markdown/wysiwyg/MarkdownSourceBridge'
import { DocumentManager } from '../src/editor/core/DocumentManager'

describe('Markdown Live Image Deletion - Data Model & SourceBridge', () => {
  it('1. Code block + image + heading: deleting image paragraph leaves code fence and heading intact', () => {
    const source = '```java\nSystem.out.println("Hello");\n```\n\n![图片](./assets/test.png)\n\n## 下一章节'
    const bridge = new MarkdownSourceBridge(source)
    const state = EditorState.create({ doc: bridge.doc })

    let imgPos: number | undefined
    state.doc.descendants((node, pos) => {
      if (node.type === s.nodes.image && imgPos === undefined) imgPos = pos
    })
    expect(imgPos).toBeDefined()

    const $pos = state.doc.resolve(imgPos!)
    expect($pos.parent.type.name).toBe('paragraph')
    expect($pos.parent.childCount).toBe(1)

    // Delete standalone paragraph
    const tr = state.tr.delete($pos.before(), $pos.after())
    const prepared = bridge.prepare(tr.doc)
    prepared.commit()

    expect(bridge.doc.childCount).toBe(2)
    expect(bridge.doc.child(0).type.name).toBe('code_block')
    expect(bridge.doc.child(0).attrs.params).toBe('java')
    expect(bridge.doc.child(0).textContent).toBe('System.out.println("Hello");')
    expect(bridge.doc.child(1).type.name).toBe('heading')
    expect(bridge.doc.child(1).attrs.level).toBe(2)
    expect(bridge.doc.child(1).textContent).toBe('下一章节')

    expect(bridge.source).toBe('```java\nSystem.out.println("Hello");\n```\n\n## 下一章节')
  })

  it('2. Regular paragraph + image + heading: deleting standalone image paragraph', () => {
    const source = '前置普通段落\n\n![图片](./assets/test.png)\n\n## 下一章节'
    const bridge = new MarkdownSourceBridge(source)
    const state = EditorState.create({ doc: bridge.doc })

    let imgPos: number | undefined
    state.doc.descendants((node, pos) => {
      if (node.type === s.nodes.image && imgPos === undefined) imgPos = pos
    })
    const $pos = state.doc.resolve(imgPos!)
    const tr = state.tr.delete($pos.before(), $pos.after())
    const prepared = bridge.prepare(tr.doc)
    prepared.commit()

    expect(bridge.doc.childCount).toBe(2)
    expect(bridge.doc.child(0).textContent).toBe('前置普通段落')
    expect(bridge.doc.child(1).textContent).toBe('下一章节')
    expect(bridge.source).toBe('前置普通段落\n\n## 下一章节')
  })

  it('3. Image at document start: deleting standalone paragraph', () => {
    const source = '![图片](./assets/test.png)\n\n## 下一章节'
    const bridge = new MarkdownSourceBridge(source)
    const state = EditorState.create({ doc: bridge.doc })

    let imgPos: number | undefined
    state.doc.descendants((node, pos) => {
      if (node.type === s.nodes.image && imgPos === undefined) imgPos = pos
    })
    const $pos = state.doc.resolve(imgPos!)
    const tr = state.tr.delete($pos.before(), $pos.after())
    const prepared = bridge.prepare(tr.doc)
    prepared.commit()

    expect(bridge.doc.childCount).toBe(1)
    expect(bridge.doc.child(0).type.name).toBe('heading')
    expect(bridge.source).toBe('## 下一章节')
  })

  it('4. Image at document end: deleting standalone paragraph', () => {
    const source = '# 章节标题\n\n![图片](./assets/test.png)'
    const bridge = new MarkdownSourceBridge(source)
    const state = EditorState.create({ doc: bridge.doc })

    let imgPos: number | undefined
    state.doc.descendants((node, pos) => {
      if (node.type === s.nodes.image && imgPos === undefined) imgPos = pos
    })
    const $pos = state.doc.resolve(imgPos!)
    const tr = state.tr.delete($pos.before(), $pos.after())
    const prepared = bridge.prepare(tr.doc)
    prepared.commit()

    expect(bridge.doc.childCount).toBe(1)
    expect(bridge.doc.child(0).type.name).toBe('heading')
    expect(bridge.source).toBe('# 章节标题')
  })

  it('5. Image is sole document content: preserves minimal valid document structure', () => {
    const source = '![图片](./assets/test.png)'
    const bridge = new MarkdownSourceBridge(source)
    const state = EditorState.create({ doc: bridge.doc })

    let imgPos: number | undefined
    state.doc.descendants((node, pos) => {
      if (node.type === s.nodes.image && imgPos === undefined) imgPos = pos
    })
    const tr = state.tr.delete(imgPos!, imgPos! + 1)
    const prepared = bridge.prepare(tr.doc)
    prepared.commit()

    expect(bridge.doc.childCount).toBe(1)
    expect(bridge.doc.child(0).type.name).toBe('paragraph')
    expect(bridge.doc.child(0).content.size).toBe(0)
    expect(bridge.source).toBe('')
  })

  it('6. Image with inline text: preserves surrounding text and deletes only image', () => {
    const source = '前置文字 ![图片](./assets/test.png) 后置文字'
    const bridge = new MarkdownSourceBridge(source)
    const state = EditorState.create({ doc: bridge.doc })

    let imgPos: number | undefined
    state.doc.descendants((node, pos) => {
      if (node.type === s.nodes.image && imgPos === undefined) imgPos = pos
    })
    const tr = state.tr.delete(imgPos!, imgPos! + 1)
    const prepared = bridge.prepare(tr.doc)
    prepared.commit()

    expect(bridge.doc.childCount).toBe(1)
    expect(bridge.doc.child(0).textContent).toBe('前置文字  后置文字')
    expect(bridge.source).toBe('前置文字  后置文字')
  })

  it('7. Consecutive images: deleting first image leaves second intact', () => {
    const source = '![图片1](./assets/1.png)\n\n![图片2](./assets/2.png)'
    const bridge = new MarkdownSourceBridge(source)
    const state = EditorState.create({ doc: bridge.doc })

    let firstImgPos: number | undefined
    state.doc.descendants((node, pos) => {
      if (node.type === s.nodes.image && firstImgPos === undefined) firstImgPos = pos
    })
    const $pos = state.doc.resolve(firstImgPos!)
    const tr = state.tr.delete($pos.before(), $pos.after())
    const prepared = bridge.prepare(tr.doc)
    prepared.commit()

    expect(bridge.doc.childCount).toBe(1)
    expect(bridge.doc.child(0).firstChild?.attrs.src).toBe('./assets/2.png')
    expect(bridge.source).toBe('![图片2](./assets/2.png)')
  })

  it('8 & 9. NodeSelection keyboard deletion followed immediately by Backspace / Delete', () => {
    const source = '```java\nSystem.out.println("Hello");\n```\n\n![图片](./assets/test.png)\n\n## 下一章节'
    const bridge = new MarkdownSourceBridge(source)
    let state = EditorState.create({ doc: bridge.doc })

    let imgPos: number | undefined
    state.doc.descendants((node, pos) => {
      if (node.type === s.nodes.image && imgPos === undefined) imgPos = pos
    })
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, imgPos!)))
    expect(state.selection).toBeInstanceOf(NodeSelection)

    // Step 1: Backspace on NodeSelection deletes image, leaving empty paragraph
    let tr1: any
    expect(baseKeymap.Backspace(state, tr => { tr1 = tr })).toBe(true)
    state = state.apply(tr1)
    expect(state.doc.childCount).toBe(3)
    expect(state.doc.child(1).type.name).toBe('paragraph')
    expect(state.doc.child(1).content.size).toBe(0)
    expect(state.selection).toBeInstanceOf(TextSelection)

    // Step 2: Next Backspace immediately deletes the empty paragraph
    let tr2: any
    expect(baseKeymap.Backspace(state, tr => { tr2 = tr })).toBe(true)
    state = state.apply(tr2)
    expect(state.doc.childCount).toBe(2)
    expect(state.doc.child(0).type.name).toBe('code_block')
    expect(state.doc.child(1).type.name).toBe('heading')

    const prepared = bridge.prepare(state.doc)
    prepared.commit()
    expect(bridge.source).toBe('```java\nSystem.out.println("Hello");\n```\n\n## 下一章节')
  })

  it('10 & 11. Image deletion followed immediately by typing text', () => {
    const source = '![图片](./assets/test.png)'
    const bridge = new MarkdownSourceBridge(source)
    let state = EditorState.create({ doc: bridge.doc })

    let imgPos: number | undefined
    state.doc.descendants((node, pos) => {
      if (node.type === s.nodes.image && imgPos === undefined) imgPos = pos
    })
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, imgPos!)))
    let tr1: any
    baseKeymap.Backspace(state, tr => { tr1 = tr })
    state = state.apply(tr1)

    // Type text immediately
    const tr2 = state.tr.insertText('测试中文输入 and English')
    state = state.apply(tr2)
    expect(state.doc.child(0).textContent).toBe('测试中文输入 and English')
    const prepared = bridge.prepare(state.doc)
    prepared.commit()
    expect(bridge.source).toBe('测试中文输入 and English')
  })

  it('12. Code block fence, indentation and heading level preserved', () => {
    const source = '~~~~~python extra\ndef test():\n    return 42\n~~~~~\n\n![图片](./assets/test.png)\n\n#### 保持四级标题'
    const bridge = new MarkdownSourceBridge(source)
    const state = EditorState.create({ doc: bridge.doc })

    let imgPos: number | undefined
    state.doc.descendants((node, pos) => {
      if (node.type === s.nodes.image && imgPos === undefined) imgPos = pos
    })
    const $pos = state.doc.resolve(imgPos!)
    const tr = state.tr.delete($pos.before(), $pos.after())
    const prepared = bridge.prepare(tr.doc)
    prepared.commit()

    expect(bridge.source).toBe('~~~~~python extra\ndef test():\n    return 42\n~~~~~\n\n#### 保持四级标题')
    expect(bridge.doc.child(0).attrs.fence).toBe('~~~~~')
    expect(bridge.doc.child(0).attrs.params).toBe('python extra')
    expect(bridge.doc.child(1).attrs.level).toBe(4)
  })

  it('15. Undo and redo: full fidelity of document structure and markdown source', () => {
    const initialSource = '```java\nSystem.out.println("Hello");\n```\n\n![图片](./assets/test.png)\n\n## 下一章节'
    const manager = new DocumentManager([
      { id: 'md', name: 'test.md', path: 'test.md', text: initialSource }
    ], async () => [])
    manager.open('md', false)

    const text = manager.getText('md')!
    const from = text.indexOf('\n\n![图片]')
    const to = text.indexOf('\n\n## 下一章节')

    // Dispatch deletion through manager
    manager.dispatch('md', {
      changes: { from, to, insert: '' }
    })
    expect(manager.getText('md')).toBe('```java\nSystem.out.println("Hello");\n```\n\n## 下一章节')

    // Undo
    manager.command('undo')
    expect(manager.getText('md')).toBe(initialSource)

    // Redo
    manager.command('redo')
    expect(manager.getText('md')).toBe('```java\nSystem.out.println("Hello");\n```\n\n## 下一章节')
    manager.dispose()
  })

  it('16. Markdown Source/Live mode switching preserves deletion', () => {
    const manager = new DocumentManager([
      { id: 'md', name: 'test.md', path: 'test.md', text: '```java\ncode\n```\n\n![图片](./assets/test.png)\n\n## 标题' }
    ], async () => [])
    manager.open('md', false)
    manager.setMarkdownMode('md', 'live')
    expect(manager.metadata('md')?.mode).toBe('live')

    // Delete image line
    const text = manager.getText('md')!
    const imgIndex = text.indexOf('![图片]')
    manager.dispatch('md', {
      changes: { from: text.lastIndexOf('\n\n', imgIndex), to: text.indexOf('\n\n##', imgIndex), insert: '' }
    })
    expect(manager.getText('md')).toBe('```java\ncode\n```\n\n## 标题')

    manager.setMarkdownMode('md', 'source')
    expect(manager.getText('md')).toBe('```java\ncode\n```\n\n## 标题')

    manager.setMarkdownMode('md', 'live')
    expect(manager.getText('md')).toBe('```java\ncode\n```\n\n## 标题')
    manager.dispose()
  })

  it('17. Multi-pane synchronization', () => {
    const manager = new DocumentManager([
      { id: 'md', name: 'test.md', path: 'test.md', text: '```java\ncode\n```\n\n![图片](./assets/test.png)\n\n## 标题' }
    ], async () => [])
    manager.open('md', false)
    manager.splitEditor()
    expect(manager.isSplit).toBe(true)

    const text = manager.getText('md')!
    const imgIndex = text.indexOf('![图片]')
    manager.dispatch('md', {
      changes: { from: text.lastIndexOf('\n\n', imgIndex), to: text.indexOf('\n\n##', imgIndex), insert: '' }
    })
    expect(manager.getText('md')).toBe('```java\ncode\n```\n\n## 标题')
    manager.dispose()
  })

  it('18. Save snapshot reflects exact deletion without extra whitespace', () => {
    const manager = new DocumentManager([
      { id: 'md', name: 'test.md', path: 'test.md', text: '```java\ncode\n```\n\n![图片](./assets/test.png)\n\n## 标题\n' }
    ], async () => [])
    manager.open('md', false)
    const text = manager.getText('md')!
    const imgIndex = text.indexOf('![图片]')
    manager.dispatch('md', {
      changes: { from: text.lastIndexOf('\n\n', imgIndex), to: text.indexOf('\n\n##', imgIndex), insert: '' }
    })
    const snapshot = manager.saveSnapshot('md')
    expect(snapshot?.text).toBe('```java\ncode\n```\n\n## 标题\n')
    manager.dispose()
  })
})
