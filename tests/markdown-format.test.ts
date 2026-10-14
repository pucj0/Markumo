import { describe, it, expect } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { markdownFormatTransaction } from '../src/editor/markdown/formatCommands'

describe('Markdown menu transactions', () => {
  it('formats a large selection containing many backtick runs without an argument-stack overflow', () => {
    const text = ' ` '.repeat(140000)
    const state = EditorState.create({ doc: text, selection: { anchor: 0, head: text.length } })
    const next = state.update(markdownFormatTransaction(state, 'code-block')).state
    expect(next.doc.toString()).toBe('```\n' + text + '\n```')
  })
  it('wraps and toggles a selection, with each action undoable and no effect on plain text', () => {
    const m = new DocumentManager([{ id:'md', name:'a.md', path:'', text:'中文 word' }, { id:'txt', name:'a.txt', path:'', text:'plain' }])
    m.open('md', false); m.dispatch('md', { selection:{anchor:3,head:7} })
    expect(m.formatMarkdown('bold')).toBe(true); expect(m.getText('md')).toBe('中文 **word**')
    m.formatMarkdown('bold'); expect(m.getText('md')).toBe('中文 word')
    m.command('undo'); expect(m.getText('md')).toBe('中文 **word**')
    m.command('undo'); expect(m.getText('md')).toBe('中文 word')
    m.command('redo'); expect(m.getText('md')).toBe('中文 **word**')
    m.open('txt',false); expect(m.formatMarkdown('bold')).toBe(false); expect(m.getText('txt')).toBe('plain'); m.dispose()
  })
  it('formats multi-cursor selections as one transaction and preserves CRLF through undo', () => {
    const m = new DocumentManager([{id:'md',name:'a.md',path:'',text:'one\r\ntwo'}]);m.open('md',false)
    m.dispatch('md',{selection:EditorSelection.create([EditorSelection.range(0,3),EditorSelection.range(4,7)])})
    m.formatMarkdown('italic');expect(m.getText('md')).toBe('*one*\n*two*')
    m.command('undo');expect(m.saveSnapshot('md')!.text).toBe('one\r\ntwo');m.dispose()
  })
  it('prefixes overlapping selected lines once, preserves indentation and safely wraps code containing fences', () => {
    const m=new DocumentManager([{id:'md',name:'a.md',path:'',text:'  hello\nworld'}]);m.open('md',false)
    m.dispatch('md',{selection:EditorSelection.create([EditorSelection.range(2,4),EditorSelection.range(5,12)])})
    m.formatMarkdown('task');expect(m.getText('md')).toBe('  - [ ] hello\n- [ ] world')
    m.command('undo');expect(m.getText('md')).toBe('  hello\nworld')
    m.dispatch('md',{changes:{from:0,to:m.getState('md')!.doc.length,insert:'before ```nested``` after'},selection:{anchor:7,head:19}})
    m.formatMarkdown('code-block');expect(m.getText('md')).toBe('before \n````\n```nested```\n````\n after');m.dispose()
  })
})
