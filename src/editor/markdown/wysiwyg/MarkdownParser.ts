import MarkdownIt from 'markdown-it'
import { inlineHtmlRanges } from './HtmlSourceRanges'
import { MarkdownParser, defaultMarkdownParser } from 'prosemirror-markdown'
import type { Node } from 'prosemirror-model'
import { markdownSchema as s } from './MarkdownSchema'
import { installMarkdownMath } from '../mathSemantics'

export const tokenizer = new MarkdownIt('commonmark', {html:true,linkify:true}).enable(['table','strikethrough','linkify'])
installMarkdownMath(tokenizer)
const tokens = { ...defaultMarkdownParser.tokens,
  table:{block:'table'}, thead:{ignore:true}, tbody:{ignore:true}, tr:{block:'table_row'},
  th:{block:'table_header',getAttrs:(tok: ReturnType<typeof tokenizer.parse>[number])=>({align:String(tok.attrGet('style')||'').replace('text-align:','') || null})},
  td:{block:'table_cell',getAttrs:(tok: ReturnType<typeof tokenizer.parse>[number])=>({align:String(tok.attrGet('style')||'').replace('text-align:','') || null})},
  s:{mark:'strike'}, softbreak:{node:'soft_break'},
  math_inline:{node:'math_inline',getAttrs:(tok:ReturnType<typeof tokenizer.parse>[number])=>({latex:tok.content})},
  math_block:{block:'protected_source',noCloseToken:true,getAttrs:(tok:ReturnType<typeof tokenizer.parse>[number])=>({source:tok.content})},
  footnote_reference:{node:'footnote_reference',getAttrs:(tok:ReturnType<typeof tokenizer.parse>[number])=>({label:tok.content})},
  html_inline:{node:'html_inline',getAttrs:(tok:ReturnType<typeof tokenizer.parse>[number])=>({source:tok.content})},
  html_block:{block:'html_block',noCloseToken:true,getAttrs:(tok:ReturnType<typeof tokenizer.parse>[number])=>({source:tok.content})},
  fence:{block:'code_block',noCloseToken:true,getAttrs:(tok: ReturnType<typeof tokenizer.parse>[number])=>({params:tok.info,fence:tok.markup})},
  bullet_list:{...defaultMarkdownParser.tokens.bullet_list,getAttrs:(tok: ReturnType<typeof tokenizer.parse>[number])=>({bullet:tok.markup,tight:true})},
  list_item:{block:'list_item',getAttrs:(tok: ReturnType<typeof tokenizer.parse>[number])=>({checked:tok.meta?.checked ?? null})},
}
tokenizer.inline.ruler.before('escape','markumo_footnotes',(state,silent)=>{
  const note=/^\[\^([^\]\n]+)\]/.exec(state.src.slice(state.pos))
  if(!note)return false
  if(!silent){const token=state.push('footnote_reference','sup',0);token.content=note[1]}
  state.pos+=note[0].length;return true
})
// Task syntax becomes a real list-item attribute. No checkbox state lives only in DOM.
tokenizer.core.ruler.after('inline','markumo_tasks', state => {
  const stack: typeof state.tokens = []
  for (const token of state.tokens) {
    if(token.type==='list_item_open') stack.push(token)
    if(token.type==='list_item_close') stack.pop()
    if(token.type!=='inline' || !stack.length) continue
    const first=token.children?.[0], match=first?.type==='text' && /^\[([ xX])\] /.exec(first.content)
    if(match){stack[stack.length-1].meta={checked:match[1]!==' '};first!.content=first!.content.slice(match[0].length)}
  }
})
// Consume paired HTML directly from source before Markdown strips delimiters.
// Cache ranges per inline parser state, never search rendered text.
const htmlRanges = new WeakMap<object, ReturnType<typeof inlineHtmlRanges>>()
tokenizer.inline.ruler.before('html_inline','markumo_html_source', (state,silent)=>{
  if(state.src[state.pos]!=='<')return false
  let ranges=htmlRanges.get(state)
  if(!ranges){ranges=inlineHtmlRanges(state.src);htmlRanges.set(state,ranges)}
  const range=ranges.find(range=>range.from===state.pos)
  if(!range)return false
  if(!silent){const token=state.push('html_inline','',0);token.content=state.src.slice(range.from,range.to)}
  state.pos=range.to;return true
})
tokenizer.core.ruler.after('markumo_tasks','markumo_cells', state=>{
  const result:typeof state.tokens=[]
  for(const token of state.tokens){
    if(token.type==='th_close'||token.type==='td_close')result.push(new state.Token('paragraph_close','p',-1))
    result.push(token)
    if(token.type==='th_open'||token.type==='td_open')result.push(new state.Token('paragraph_open','p',1))
  }
  state.tokens=result
})
// prosemirror-markdown still declares markdown-it 14 types; the shared runtime
// is markdown-it 15. Only this official adapter boundary needs a type bridge.
export const markdownParser = new MarkdownParser(s, tokenizer as unknown as ConstructorParameters<typeof MarkdownParser>[1], tokens as unknown as ConstructorParameters<typeof MarkdownParser>[2])
export interface SourceBlock { id:string; from:number; to:number; raw:string; prefix:string; node:Node }
let identity=0
export function parseMarkdown(source:string, referenceEnvironment:Record<string,unknown> = {}, previous?:{blocks:readonly SourceBlock[];environment:Record<string,unknown>}) {
  const starts=[0]; for(let i=0;i<source.length;i++)if(source[i]==='\n')starts.push(i+1)
  const yaml=/^---\n[\s\S]*?\n(?:---|\.\.\.)(?:\n|$)/.exec(source)
  const scan=yaml ? yaml[0].replace(/[^\n]/g,' ') + source.slice(yaml[0].length) : source
  const env: Record<string, unknown> = { ...referenceEnvironment, references: { ...referenceEnvironment.references as object } }
  const parsed=tokenizer.parse(scan,env)
  // Reuse immutable blocks from the current revision only. Tokenization still
  // establishes the new reference environment first; changed references force
  // normal parsing, even when the referring block's raw text is unchanged.
  const reusable=new Map<string,{blocks:SourceBlock[];used:number}>()
  if(previous && JSON.stringify(previous.environment)===JSON.stringify(env)){
    for(const block of previous.blocks){
      const entry=reusable.get(block.raw)
      if(entry)entry.blocks.push(block)
      else reusable.set(block.raw,{blocks:[block],used:0})
    }
  }
  const ranges:{from:number;to:number;raw?:boolean;isHtml?:boolean;label?:string}[]=[]
  if(yaml)ranges.push({from:0,to:yaml[0].replace(/\n$/,'').length,raw:true,label:'YAML Front Matter'})
  let level=0
  for(const token of parsed){
    if(level===0 && token.map){
      let to=starts[token.map[1]] ?? source.length
      while(to>(starts[token.map[0]]||0) && source[to-1]==='\n'){
        to--
        if(source[to-1]==='\r')to--
      }
      ranges.push({from:starts[token.map[0]],to,raw:token.type==='html_block',label:token.type==='html_block'?'HTML（安全源码）':'扩展语法（保留源码）'})
    }
    level+=token.nesting
  }
  ranges.sort((a,b)=>a.from-b.from)
  const blocks:SourceBlock[]=[]; let cursor=0
  const add=(from:number,to:number,raw:boolean,label='扩展语法（保留源码）')=>{
    const original=source.slice(from,to),entry=reusable.get(original)
    const candidate=entry && entry.used<entry.blocks.length?entry.blocks[entry.used++]:undefined
    // Protected blocks can depend on position (notably YAML at document start).
    const reused=!raw && candidate?.node.type.name!=='protected_source'?candidate:undefined
    const id=reused?.id || `md-${++identity}`
    let node:Node
    if(reused)node=reused.node
    else try {
      const complex=raw || /(^|\n)(?:\[\^[^\]]+\]:| {0,3}\$\$|\[toc\]|:::+|>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])/i.test(original)
      if(complex) node=s.nodes.protected_source.create({source:original,label})
      else {
        node=markdownParser.parse(original,env).firstChild!
        if(!node)node=s.nodes.protected_source.create({source:original,label})
      }
    }catch{node=s.nodes.protected_source.create({source:original,label})}
    if(!reused)node=node.type.create({...node.attrs,sourceId:id},node.content,node.marks)
    blocks.push({id,from,to,raw:original,prefix:source.slice(cursor,from),node});cursor=to
  }
  for(const range of ranges){
    if(range.from<cursor)continue
    const gap=source.slice(cursor,range.from)
    if(gap.trim()){const from=cursor+(gap.match(/^\s*/)?.[0].length||0);add(from,range.from-gap.match(/\s*$/)![0].length,true,'引用定义 / 扩展源码')}
    add(range.from,range.to,!!range.raw,range.label)
  }
  if(source.slice(cursor).trim())add(cursor,source.length,true,'引用定义 / 扩展源码')
  const doc=s.nodes.doc.create(null,blocks.length?blocks.map(b=>b.node):s.nodes.paragraph.create())
  return {doc,blocks,tail:source.slice(cursor),environment:env}
}
