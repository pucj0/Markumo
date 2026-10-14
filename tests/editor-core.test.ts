import { describe, it, expect } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { undo, redo, undoDepth } from '@codemirror/commands'
import { language as languageFacet } from '@codemirror/language'
import { json } from '@codemirror/lang-json'
import { javascript } from '@codemirror/lang-javascript'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { TabGroup } from '../src/features/tabs/TabGroup'
import { detectLanguage, languageNames, loadLanguage } from '../src/editor/languages'

const samples = [
  { id: 'a', name: 'one.txt', path: 'one.txt', text: 'first\nsecond\nthird' },
  { id: 'b', name: 'two.json', path: 'two.json', text: '{"n":1}' },
  { id: 'c', name: 'three.md', path: 'three.md', text: '# 源码\n**中文**' },
]
const makeManager = () => new DocumentManager(samples, async () => [])
function applyUndo(manager: DocumentManager, id: string, action = undo) {
  return action({ state: manager.getState(id)!, dispatch: tr => manager.dispatch(id, tr) })
}

describe('语言识别和官方按需模块', () => {
  it('支持约定的扩展名、大小写和 Windows 路径，未知及无扩展名退回纯文本', () => {
    const names = ['a.txt', 'a.md', 'a.markdown', 'a.json', 'a.jsonc', 'a.yml', 'a.yaml', 'a.toml', 'a.js', 'a.ts', 'a.jsx', 'a.tsx', 'a.vue', 'a.html', 'a.css', 'a.py', 'a.go', 'a.rs', 'a.sql', 'a.xml', 'a.ini', 'a.csv', 'a.log']
    expect(names.map(detectLanguage)).toEqual(['Plain Text', 'Markdown', 'Markdown', 'JSON', 'JSONC', 'YAML', 'YAML', 'TOML', 'JavaScript', 'TypeScript', 'JSX', 'TSX', 'Vue', 'HTML', 'CSS', 'Python', 'Go', 'Rust', 'SQL', 'XML', 'INI', 'CSV', 'Log'])
    expect(detectLanguage('C:\\notes\\README.MARKDOWN')).toBe('Markdown')
    expect(detectLanguage('Dockerfile')).toBe('Plain Text')
    expect(detectLanguage('.env')).toBe('Plain Text')
    expect(detectLanguage('unknown.bin')).toBe('Plain Text')
  })
  it.each(languageNames)('%s 模块能装入真实 EditorState，并保持源文', async name => {
    const extension = await loadLanguage(name)
    const state = EditorState.create({ doc: '中文\nsource', extensions: [extension] })
    expect(state.doc.toString()).toBe('中文\nsource')
    if (!['Plain Text', 'CSV', 'Log'].includes(name)) expect(state.facet(languageFacet)).not.toBeNull()
    expect(await loadLanguage(name)).toBe(extension)
  })
})

describe('TabGroup', () => {
  it('一个预览槽，固定标签不被替换，已有标签不降级', () => {
    const group = new TabGroup()
    group.open('fixed', false)
    group.open('a')
    expect(group.open('b')).toBe('a')
    group.pin('b')
    group.open('c')
    group.open('fixed')
    expect(group.tabs).toEqual([{ documentId: 'fixed', pinned: true }, { documentId: 'b', pinned: true }, { documentId: 'c', pinned: false }])
  })
  it('关闭非活动标签不改变活动文档，关闭末项时正确选邻居', () => {
    const group = new TabGroup()
    group.open('a', false); group.open('b', false); group.open('c', false)
    group.close('a'); expect(group.activeId).toBe('c')
    group.close('c'); expect(group.activeId).toBe('b')
    group.close('b'); expect(group.activeId).toBeNull()
  })
  it('不同组的布局状态独立，文档 ID 不因组位置而改变', () => {
    const left = new TabGroup('left'), right = new TabGroup('right')
    left.open('shared', false); right.open('shared')
    right.open('other')
    expect(left.activeId).toBe('shared')
    expect(left.tabs[0].pinned).toBe(true)
  })
})

describe('DocumentManager', () => {
  it('元数据不含全文或 EditorState，编辑后固定预览并更新行列和 dirty', () => {
    const manager = makeManager()
    manager.open('a')
    manager.dispatch('a', { changes: { from: 0, to: 5, insert: '中文' }, selection: { anchor: 3 } })
    expect(manager.activeDocument).toMatchObject({ dirty: true, pinned: true, line: 2, column: 1, uri: 'sample:a' })
    expect(manager.activeDocument).not.toHaveProperty('content')
    expect(manager.activeDocument).not.toHaveProperty('editorState')
    manager.open('b')
    expect(manager.openedDocuments.map(doc => doc.id)).toEqual(['a', 'b'])
    manager.dispose()
  })
  it('切换标签保持同一个文档对象、多光标和独立撤销历史', () => {
    const manager = makeManager()
    manager.open('a', false)
    manager.dispatch('a', { changes: { from: 0, insert: 'edited ' }, selection: EditorSelection.create([EditorSelection.range(1, 3), EditorSelection.cursor(8)]) })
    const state = manager.getState('a')!
    manager.open('b', false)
    manager.dispatch('b', { changes: { from: 1, insert: ' ' } })
    manager.select('a')
    expect(manager.getState('a')).toBe(state)
    expect(manager.getState('a')!.selection.ranges).toHaveLength(2)
    expect(applyUndo(manager, 'a')).toBe(true)
    expect(manager.getText('a')).toBe(samples[0].text)
    expect(manager.metadata('a')!.dirty).toBe(false)
    expect(manager.getText('b')).toBe('{ "n":1}')
    expect(applyUndo(manager, 'a', redo)).toBe(true)
    expect(manager.metadata('a')!.dirty).toBe(true)
    manager.dispose()
  })
  it('语言、主题和换行重配置不改源码、选区或撤销记录', async () => {
    const manager = makeManager()
    manager.open('a', false)
    manager.dispatch('a', { changes: { from: 0, insert: 'x' }, selection: { anchor: 4 } })
    const state = manager.getState('a')!
    await manager.setLanguage('a', 'Rust')
    manager.setWrap(true); manager.setTheme('light')
    expect(manager.getState('a')!.doc).toBe(state.doc)
    expect(manager.getState('a')!.selection.eq(state.selection)).toBe(true)
    expect(undoDepth(manager.getState('a')!)).toBe(undoDepth(state))
    expect(applyUndo(manager, 'a')).toBe(true)
    manager.dispose()
  })
  it('忽略过期语言加载结果及已关闭文档的迟到结果', async () => {
    let completeRust: ((extension: ReturnType<typeof json>) => void) | undefined
    const manager = new DocumentManager(samples, name => name === 'Rust' ? new Promise(resolve => { completeRust = resolve }) : Promise.resolve(name === 'JSON' ? json() : javascript()))
    manager.open('a', false)
    const older = manager.setLanguage('a', 'Rust')
    await manager.setLanguage('a', 'JSON')
    completeRust!(javascript()); await older
    expect(manager.metadata('a')!.language).toBe('JSON')
    expect(manager.getState('a')!.facet(languageFacet)!.name).toBe('json')
    const closing = manager.setLanguage('a', 'Rust')
    manager.close('a')
    expect(manager.getState('a')).toBeUndefined()
    manager.open('a', false)
    await manager.setLanguage('a', 'JSON')
    const reopened = manager.getState('a')
    let notices = 0
    const unsubscribe = manager.subscribe(() => notices++)
    completeRust!(javascript()); await closing
    expect(manager.getState('a')).toBe(reopened)
    expect(manager.metadata('a')!.language).toBe('JSON')
    expect(notices).toBe(0)
    unsubscribe()
    manager.dispose()
  })
  it('语言加载失败安全降级且可重试，不丢编辑内容', async () => {
    let fail = false
    const manager = new DocumentManager(samples, async () => { if (fail) throw new Error('offline'); return json() })
    manager.open('b', false)
    await manager.setLanguage('b', 'JSON')
    fail = true
    await manager.setLanguage('b', 'Rust')
    expect(manager.metadata('b')!.languageStatus).toBe('error')
    expect(manager.getState('b')!.facet(languageFacet)).toBeNull()
    expect(manager.getText('b')).toBe(samples[1].text)
    fail = false; await manager.setLanguage('b', 'JSON')
    expect(manager.metadata('b')!.languageStatus).toBe('ready')
    manager.dispose()
  })
  it('拒绝未知文档、关闭 dirty 要确认、关闭草稿释放缓存', () => {
    const manager = makeManager()
    expect(manager.open('missing')).toBe(false)
    expect(manager.openedDocuments).toEqual([])
    const id = manager.createUntitled()!
    manager.dispatch(id, { changes: { from: 0, insert: '不要丢失' } })
    expect(manager.close(id)).toBe('dirty')
    expect(manager.getText(id)).toBe('不要丢失')
    expect(manager.hasDirtyDocuments).toBe(true)
    expect(manager.close(id, true)).toBe('closed')
    expect(manager.getState(id)).toBeUndefined()
    expect(manager.catalog.some(doc => doc.id === id)).toBe(false)
    expect(manager.hasDirtyDocuments).toBe(false)
    manager.dispose()
  })
  it('Unicode、大段粘贴与撤销按源文本处理，Markdown 不转换', () => {
    const manager = makeManager()
    manager.open('c', false)
    const pasted = '中文🚀\n'.repeat(1000)
    manager.dispatch('c', { changes: { from: manager.getState('c')!.doc.length, insert: pasted } })
    manager.select('c')
    expect(manager.getText('c')).toBe(samples[2].text + pasted)
    expect(manager.activeDocument!.mode).toBe('live')
    applyUndo(manager, 'c')
    expect(manager.getText('c')).toBe(samples[2].text)
    manager.dispose()
  })
})
