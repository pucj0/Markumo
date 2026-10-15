import { describe,it,expect } from 'vitest'
import { EditorState,TextSelection } from 'prosemirror-state'
import { addRowAfter,addColumnAfter } from 'prosemirror-tables'
import { MarkdownSourceBridge } from '../src/editor/markdown/wysiwyg/MarkdownSourceBridge'
import { parseMarkdown } from '../src/editor/markdown/wysiwyg/MarkdownParser'
import { serializeBlock } from '../src/editor/markdown/wysiwyg/MarkdownSerializer'
import { markdownSchema as s } from '../src/editor/markdown/wysiwyg/MarkdownSchema'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { relativeMarkdownLink } from '../src/editor/markdown/links'
import { defaultSettings, settingsFrom } from '../src/features/shell/editorSettings'

describe('ProseMirror source preservation',()=>{
  const source='---\ntitle: 中文\n---\n\nHeading\n=======\n\n  prose **bold** &amp; \\*literal\\*\n\n~~~~js extra\nlet x = `value`\n~~~~\n\n| a  | **b** |\n| :-- | --: |\n| 中文 | `a\\|b` |\n\n[ref]: https://example.com "title"\n\n[reference][ref]\n\n$$\na+b\n$$\n'
  it('never serializes on parse, no-op, or mode change; preserves CRLF/BOM metadata',()=>{
    const bridge=new MarkdownSourceBridge(source);expect(bridge.prepare(bridge.doc).source).toBe(source)
    const manager=new DocumentManager([{id:'md',name:'x.md',path:'x.md',text:source.replace(/\n/g,'\r\n')}],async()=>[]);manager.open('md',false)
    for(const mode of ['source','split','live'] as const)manager.setMarkdownMode('md',mode)
    expect(manager.saveSnapshot('md')?.text).toBe(source.replace(/\n/g,'\r\n'));expect(manager.metadata('md')?.dirty).toBe(false);manager.dispose()
  })
  it('parses real table cells, task attributes, marks, links and protected blocks',()=>{
    const parsed=parseMarkdown('# H\n\n- [x] task\n\n| a | b |\n| - | - |\n| ~~中~~ | [x](https://example.com) |\n\n<div>unsafe</div>')
    expect(parsed.doc.child(0).type.name).toBe('heading');expect(parsed.doc.child(1).child(0).attrs.checked).toBe(true)
    expect(parsed.doc.child(2).type.name).toBe('table');expect(parsed.doc.child(2).child(1).child(0).child(0).firstChild?.marks[0].type.name).toBe('strike')
    expect(parsed.doc.lastChild?.type.name).toBe('protected_source');parsed.doc.check()
  })
  it('editing a paragraph leaves unrelated blocks and reference definitions byte-identical',()=>{
    const bridge=new MarkdownSourceBridge(source),state=EditorState.create({doc:bridge.doc});let at=0
    state.doc.forEach((node,pos)=>{if(node.type.name==='paragraph'&&node.textContent.includes('prose'))at=pos+1})
    const next=bridge.prepare(state.tr.insertText('新',at).doc)
    expect(next.source).toContain('~~~~js extra\nlet x = `value`\n~~~~');expect(next.source).toContain('| a  | **b** |\n| :-- | --: |\n| 中文 | `a\\|b` |')
    expect(next.source).toContain('[ref]: https://example.com "title"');expect(next.source).toContain('Heading\n=======');expect(next.source).toContain('$$\na+b\n$$')
  })
  it('only patches changed cells, keeping table whitespace and escaped pipes',()=>{
    const bridge=new MarkdownSourceBridge('| a  | **b** |\n| :-- | --: |\n| 中文 | `a\\|b` |'),state=EditorState.create({doc:bridge.doc})
    let at=0;state.doc.descendants((node,pos)=>{if(node.isText&&node.text==='中文')at=pos})
    const next=bridge.prepare(state.tr.insertText('新',at).doc)
    expect(next.source).toBe('| a  | **b** |\n| :-- | --: |\n| 新中文 | `a\\|b` |')
  })
  it('row/column operations produce legal GFM and preserve surrounding source',()=>{
    const bridge=new MarkdownSourceBridge('before\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter'),initial=EditorState.create({doc:bridge.doc})
    let pos=0;initial.doc.descendants((node,at)=>{if(node.type.name==='table_cell'&&!pos)pos=at+2})
    let state=initial.apply(initial.tr.setSelection(TextSelection.create(initial.doc,pos)))
    expect(addRowAfter(state,tr=>{state=state.apply(tr)})).toBe(true);expect(addColumnAfter(state,tr=>{state=state.apply(tr)})).toBe(true)
    const next=bridge.prepare(state.doc);expect(next.source.startsWith('before\n\n')).toBe(true);expect(next.source.endsWith('\n\nafter')).toBe(true);parseMarkdown(next.source).doc.check()
  })
  it('code retains fence character, length, info string and safely grows colliding fences',()=>{
    const doc=parseMarkdown('~~~~~js extra\ncode\n~~~~~').doc,node=doc.firstChild!
    expect(node.attrs.fence).toBe('~~~~~');expect(serializeBlock(node)).toBe('~~~~~js extra\ncode\n~~~~~')
    expect(serializeBlock(s.nodes.code_block.create({...node.attrs},s.text('~~~~~~')))).toBe('~~~~~~~js extra\n~~~~~~\n~~~~~~~')
  })
  it('stale source revisions are visible to the caller before committing',()=>{
    const bridge=new MarkdownSourceBridge('one\n\ntwo'),state=EditorState.create({doc:bridge.doc}),prepared=bridge.prepare(state.tr.insertText('!',2).doc)
    expect(bridge.source).toBe('one\n\ntwo');prepared.commit();expect(bridge.source).toBe(prepared.source)
  })
  it('repeated edits never accumulate whitespace before trailing reference definitions',()=>{
    const source='paragraph\n\n[ref]: https://example.com\n',bridge=new MarkdownSourceBridge(source)
    for(let i=0;i<5;i++){const state=EditorState.create({doc:bridge.doc}),prepared=bridge.prepare(state.tr.insertText('x',2).doc);prepared.commit();expect(bridge.source.slice(bridge.source.indexOf('\n'))).toBe('\n\n[ref]: https://example.com\n')}
  })
  it('math, footnote and soft/hard breaks have explicit lossless model semantics',()=>{
    const parsed=parseMarkdown('Text $E=mc^2$ and note[^n].\nsoft  \nhard\n\n[^n]: definition\n')
    const names:string[]=[];parsed.doc.descendants(node=>{names.push(node.type.name)})
    expect(names).toContain('math_inline');expect(names).toContain('footnote_reference');expect(names).toContain('soft_break');expect(names).toContain('hard_break');parsed.doc.check()
    const bridge=new MarkdownSourceBridge('Text $E=mc^2$ and note[^n].\n\n[^n]: definition\n'),state=EditorState.create({doc:bridge.doc}),prepared=bridge.prepare(state.tr.insertText('X',1).doc)
    expect(prepared.source).toContain('$E=mc^2$');expect(prepared.source).toContain('[^n]');expect(prepared.source.endsWith('[^n]: definition\n')).toBe(true)
  })
  it('relative link resolution rejects protocols and absolute/encoded escapes before native authorization',()=>{
    expect(relativeMarkdownLink('E:\\docs\\file.md','./other.md#标题')).toEqual({path:'E:/docs/other.md',anchor:'标题'})
    for(const href of ['file:///c:/secret','javascript:alert(1)','//server/file','%2fabsolute','%00file','../../../escape'])expect(relativeMarkdownLink('E:/docs/file.md',href)).toBeNull()
  })
  it('Markdown theme defaults and settings normalization retain safe bounds without enabling autosave',()=>{
    expect(defaultSettings().markdownTypography.width).toBe(860);expect(defaultSettings().autoSave).toBe(false)
    expect(settingsFrom({markdownTypography:{width:1,fontSize:99,lineHeight:0,fontFamily:'url(evil)',codeWrap:true}}).markdownTypography).toEqual({...defaultSettings().markdownTypography,codeWrap:true})
  })
  it('literal backslashes and pipes roundtrip in edited GFM text and inline code cells',()=>{
    for(const value of ['|','\\|','a|b','a\\|b','\\\\|','中文|'])for(const code of [false,true]){
      const paragraph=s.nodes.paragraph.create(null,s.text(value,code?[s.marks.code.create()]:[])),cell=s.nodes.table_header.create(null,paragraph),table=s.nodes.table.create(null,s.nodes.table_row.create(null,cell))
      const parsed=parseMarkdown(serializeBlock(table)).doc.firstChild!
      expect(parsed.type.name).toBe('table');expect(parsed.firstChild!.firstChild!.textContent).toBe(value)
    }
  })
  it('language info containing backticks gets a valid tilde fence instead of corrupting the code block',()=>{
    const node=s.nodes.code_block.create({params:'lang `extra`',fence:'```'},s.text('code')),serialized=serializeBlock(node),parsed=parseMarkdown(serialized).doc.firstChild!
    expect(serialized.startsWith('~~~lang `extra`')).toBe(true);expect(parsed.type.name).toBe('code_block');expect(parsed.attrs.params).toBe('lang `extra`');expect(parsed.textContent).toBe('code')
  })
})
