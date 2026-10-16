import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { EditorState } from '@codemirror/state'
import { LanguageSupport, syntaxTree } from '@codemirror/language'
import { classHighlighter, highlightTree } from '@lezer/highlight'
import { languageRegistry, detectLanguage, resolveLanguage, parseFenceInfo, fenceLanguage, loadLanguage, createLanguageLoader } from '../src/editor/languages'
import { MarkdownSourceBridge } from '../src/editor/markdown/wysiwyg/MarkdownSourceBridge'
import { inlineSourceRange, parseInlineSource } from '../src/editor/markdown/wysiwyg/InlineSourceView'
import { EditorState as PMState } from 'prosemirror-state'

describe('unified language registry and real parsers', () => {
  it('resolves aliases without case sensitivity and separates fence parameters', () => {
    for (const [alias, name] of Object.entries({ js:'JavaScript',ts:'TypeScript',py:'Python',java:'Java',sh:'Shell',bash:'Shell',zsh:'Shell',pwsh:'PowerShell',ps1:'PowerShell',c:'C',h:'C',cpp:'C++',cc:'C++',cxx:'C++',hpp:'C++',cs:'C#',csharp:'C#',kt:'Kotlin',cmd:'Batch',dos:'Batch',yml:'YAML',mysql:'MySQL',postgres:'PostgreSQL',pgsql:'PostgreSQL',md:'Markdown' })) {
      expect(resolveLanguage(alias.toUpperCase())?.name).toBe(name)
      expect(fenceLanguage(`${alias.toUpperCase()} extra {line=2}`)).toBe(name)
    }
    expect(parseFenceInfo('JAVA   title="中文"').parameters).toBe('   title="中文"')
    expect(fenceLanguage('invented-js')).toBe('Plain Text')
    expect(detectLanguage('E:/src/HELLO.JAVA')).toBe('Java')
    expect(detectLanguage('Makefile')).toBe('Makefile')
    expect(detectLanguage('Dockerfile.dev')).toBe('Dockerfile')
    expect(new Set(languageRegistry.map(l=>l.id)).size).toBe(languageRegistry.length)
  })
  it.each([['Hello.java','Java'],['example.js','JavaScript'],['main.ts','TypeScript'],['example.cpp','C++'],['example.sh','Shell'],['example.bat','Batch']] as const)('parses and highlights the actual %s fixture', async (filename,name) => {
    const code=readFileSync(`tests/fixtures/language-experience/${filename}`,'utf8')
    expect(detectLanguage(filename)).toBe(name)
    const support=await loadLanguage(name) as LanguageSupport
    const state=EditorState.create({doc:code,extensions:[support]})
    expect(syntaxTree(state).length).toBe(code.length)
    const tokens:{text:string;classes:string}[]=[]
    highlightTree(support.language.parser.parse(code),classHighlighter,(from,to,classes)=>tokens.push({text:code.slice(from,to),classes}))
    expect(tokens.length).toBeGreaterThan(5)
    expect(new Set(tokens.map(t=>t.classes)).size).toBeGreaterThan(2)
    expect(tokens.some(t=>t.classes.includes('comment'))).toBe(true)
  })
  it('evicts failed loaders so retry can succeed', async () => {
    const entry=languageRegistry.find(l=>l.name==='Java')!
    const original=entry.load
    const spy=vi.spyOn(entry,'load').mockRejectedValueOnce(new Error('fixture failure'))
    const loader=createLanguageLoader()
    await expect(loader('Java')).rejects.toThrow('fixture failure')
    spy.mockImplementation(original)
    expect(await loader('Java')).toBeInstanceOf(LanguageSupport)
    spy.mockRestore()
  })
  it('uses plain PHP inside fences and mixed PHP/HTML for ordinary files', async () => {
    const fence=await loadLanguage('PHP','fence') as LanguageSupport,file=await loadLanguage('PHP') as LanguageSupport
    const code='function greet($name) { return "hello"; }'
    const tokens:string[]=[]
    highlightTree(fence.language.parser.parse(code),classHighlighter,(_from,_to,classes)=>tokens.push(classes))
    expect(tokens.some(t=>t.includes('keyword'))).toBe(true)
    expect(tokens.some(t=>t.includes('string'))).toBe(true)
    expect(fence).not.toBe(file)
  })
})

describe('inline Markdown edits preserve exact untouched source', () => {
  it('refuses an invalidated block identity rather than falling back to whole-paragraph serialization', () => {
    const bridge=new MarkdownSourceBridge('[label](https://example.com)\n')
    expect(()=>bridge.prepare(bridge.doc,{from:0,to:5,insert:'wrong',blockId:'stale'})).toThrow('目标已失效')
    expect(bridge.source).toBe('[label](https://example.com)\n')
  })
  it('keeps reference environments and removes/updates definitions without stale resolutions', () => {
    const bridge=new MarkdownSourceBridge('[label][ref]\n\n[ref]: https://example.com/old\n')
    const state=PMState.create({doc:bridge.doc})
    let from=0,to=0
    state.doc.descendants((node,pos)=>{if(node.isText&&node.text==='label'){from=pos;to=pos+node.nodeSize}})
    const range=inlineSourceRange(bridge,state.doc,from,to,'link')
    expect(range?.raw).toBe('[label][ref]')
    expect(parseInlineSource('[label][ref]',[],bridge.environment)?.firstChild?.marks[0].attrs.href).toBe('https://example.com/old')
  })
  it('addresses an empty edited block by identity instead of patching an adjacent block', () => {
    const bridge=new MarkdownSourceBridge('**one**\n\nkeep\n'),state=PMState.create({doc:bridge.doc})
    const tr=state.tr.delete(1,4)
    const first=bridge.prepare(tr.doc,{from:0,to:7,insert:'',blockId:bridge.blocks[0].id})
    first.commit()
    const next=PMState.create({doc:bridge.doc}).tr.insertText('two',1)
    expect(bridge.prepare(next.doc,{from:0,to:0,insert:'two',blockId:bridge.blocks[0].id}).source).toBe('two\n\nkeep\n')
  })
  it('edits only the current link URL, retaining neighbouring reference syntax and spacing', () => {
    const source='A [中文 English](https://example.com/old) and [other][ref].\n\n[ref]: https://example.org "keep"\n'
    const bridge=new MarkdownSourceBridge(source),state=PMState.create({doc:bridge.doc})
    let from=0,to=0
    state.doc.descendants((node,pos)=>{if(node.isText&&node.text==='中文 English'){from=pos;to=pos+node.nodeSize}})
    const range=inlineSourceRange(bridge,state.doc,from,to,'link')!
    expect(range.raw).toBe('[中文 English](https://example.com/old)')
    const raw=range.raw.replace('/old','/new'),content=parseInlineSource(raw,range.inherited)!
    const tr=state.tr.replaceWith(from,to,content)
    expect(bridge.prepare(tr.doc,{from:range.sourceFrom,to:range.sourceTo,insert:raw}).source).toBe(source.replace('/old','/new'))
    expect(parseInlineSource('one\n\nsecond')).toBeNull()
  })
})
