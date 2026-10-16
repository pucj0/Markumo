import { describe,it,expect } from 'vitest'
import { EditorState as PMState } from 'prosemirror-state'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { settingsFrom } from '../src/features/shell/editorSettings'
import { MarkdownSourceBridge } from '../src/editor/markdown/wysiwyg/MarkdownSourceBridge'
import { inlineSourceRange } from '../src/editor/markdown/wysiwyg/InlineSourceView'
import { inlineHtmlRanges } from '../src/editor/markdown/wysiwyg/HtmlSourceRanges'
import { extractOutline } from '../src/editor/outline/outlineService'
import type { EditorDocument } from '../src/types'

describe('HTML and image source contracts',()=>{
  it('defaults the image border only when absent; preserves explicit false',()=>{
    expect(settingsFrom({markdownTypography:{fontSize:17}}).markdownTypography.imageBorder).toBe(true)
    expect(settingsFrom({markdownTypography:{imageBorder:false}}).markdownTypography.imageBorder).toBe(false)
    expect(settingsFrom(JSON.parse(JSON.stringify(settingsFrom({markdownTypography:{imageBorder:false}})))).markdownTypography.imageBorder).toBe(false)
  })
  it.each([
    '![😀中文](<assets/中文 图片.png> "完整 title")',
    '> ![😀中文](<assets/中文 图片.png> "完整 title")',
    '- ![😀中文](<assets/中文 图片.png> "完整 title")',
    '| a | b |\n| - | - |\n| ![😀中文](<assets/中文 图片.png> "完整 title") | ![second](b.png) |',
    '![same](x.png) ![same](x.png)',
  ])('finds exact nested/duplicate UTF-16 image ranges: %s',source=>{
    const bridge=new MarkdownSourceBridge(source),found:{from:number;to:number;raw:string}[]=[]
    bridge.doc.descendants((node,pos)=>{if(node.type.name==='image'){
      const range=inlineSourceRange(bridge,bridge.doc,pos,pos+1,'image')
      expect(range).not.toBeNull();if(range)found.push({from:range.sourceFrom,to:range.sourceTo,raw:range.raw})
    }})
    expect(found.length).toBeGreaterThan(0)
    for(let i=0;i<found.length;i++){
      expect(source.slice(found[i].from,found[i].to)).toBe(found[i].raw)
      expect(found[i].raw).toMatch(/^!\[/)
      if(i)expect(found[i].from).toBeGreaterThanOrEqual(found[i-1].to)
    }
  })
  it('keeps HTML atom contents verbatim rather than reconstructing Markdown tokens',()=>{
    const source='prefix <span title="中文">**bold** &amp; \\*literal\\* `code`</span> suffix'
    const bridge=new MarkdownSourceBridge(source)
    const atom=bridge.doc.firstChild!.child(1)
    expect(atom.attrs.source).toBe('<span title="中文">**bold** &amp; \\*literal\\* `code`</span>')
    expect(bridge.prepare(bridge.doc).source).toBe(source)
    expect(inlineHtmlRanges('`<span>code</span>` <kbd>K</kbd>')).toEqual([{from:20,to:32}])
  })
  it('accepts incomplete local HTML only for the exact existing atom and raw range',()=>{
    const source='**marked** <span data-x="1">原文</span> [link](url "t")',bridge=new MarkdownSourceBridge(source)
    const state=PMState.create({doc:bridge.doc});let pos=-1
    state.doc.descendants((node,at)=>{if(node.type.name==='html_inline')pos=at})
    const atom=state.doc.nodeAt(pos)!,from=source.indexOf('<span'),to=source.indexOf('</span>')+7,raw='<span data-x="1">新文</span'
    const doc=state.tr.setNodeMarkup(pos,undefined,{...atom.attrs,source:raw}).doc
    expect(bridge.prepare(doc,{from,to,insert:raw,htmlOrdinal:0}).source).toBe(source.slice(0,from)+raw+source.slice(to))
    expect(()=>bridge.prepare(doc,{from:from+1,to,insert:raw,htmlOrdinal:0})).toThrow()
    expect(()=>bridge.prepare(doc,{from,to,insert:raw,htmlOrdinal:1})).toThrow()
  })
  it('extracts all HTML heading levels with nested inline text and excludes fences/comments/scripts',()=>{
    const source='# Markdown\n\nSetext\n===\n\n'+Array.from({length:6},(_,i)=>`<h${i+1}>HTML <em>${i+1}</em> &amp;</h${i+1}>`).join('\n\n')+'\n\n```html\n<h1>BAD</h1>\n```\n\n<!-- <h1>BAD</h1> -->\n\n<script><h1>BAD</h1></script>'
    const state=EditorState.create({doc:source,extensions:[markdown()]}),doc={name:'x.md',languageStatus:'ready'} as EditorDocument
    const items=extractOutline(doc,state)
    expect(items.map(x=>x.name)).toEqual(['Markdown','Setext',...Array.from({length:6},(_,i)=>`HTML ${i+1} &`)])
    expect(items.slice(2).map(x=>x.level)).toEqual([1,2,3,4,5,6])
    for(const item of items)expect(state.doc.lineAt(item.from!).number).toBe(item.lineNumber)
  })
})
