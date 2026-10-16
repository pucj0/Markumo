import MarkdownIt from 'markdown-it'
import { MarkdownParser, defaultMarkdownParser } from 'prosemirror-markdown'
import type { Node } from 'prosemirror-model'
import { markdownSchema as s } from './MarkdownSchema'

export const tokenizer = new MarkdownIt('commonmark', {html:true,linkify:true}).enable(['table','strikethrough','linkify'])
const tokens = { ...defaultMarkdownParser.tokens,
  table:{block:'table'}, thead:{ignore:true}, tbody:{ignore:true}, tr:{block:'table_row'},
  th:{block:'table_header',getAttrs:(tok: ReturnType<typeof tokenizer.parse>[number])=>({align:String(tok.attrGet('style')||'').replace('text-align:','') || null})},
  td:{block:'table_cell',getAttrs:(tok: ReturnType<typeof tokenizer.parse>[number])=>({align:String(tok.attrGet('style')||'').replace('text-align:','') || null})},
  s:{mark:'strike'}, softbreak:{node:'soft_break'},
  math_inline:{node:'math_inline',getAttrs:(tok:ReturnType<typeof tokenizer.parse>[number])=>({latex:tok.content})},
  footnote_reference:{node:'footnote_reference',getAttrs:(tok:ReturnType<typeof tokenizer.parse>[number])=>({label:tok.content})},
  html_inline:{node:'hard_break',getAttrs:(tok:ReturnType<typeof tokenizer.parse>[number])=>{if(!/^<br\s*\/?\s*>$/i.test(tok.content))throw new Error('HTML 保留源码');return null}},
  fence:{block:'code_block',noCloseToken:true,getAttrs:(tok: ReturnType<typeof tokenizer.parse>[number])=>({params:tok.info,fence:tok.markup})},
  bullet_list:{...defaultMarkdownParser.tokens.bullet_list,getAttrs:(tok: ReturnType<typeof tokenizer.parse>[number])=>({bullet:tok.markup,tight:true})},
  list_item:{block:'list_item',getAttrs:(tok: ReturnType<typeof tokenizer.parse>[number])=>({checked:tok.meta?.checked ?? null})},
}
tokenizer.inline.ruler.before('escape','lightedit_math_footnotes',(state,silent)=>{
  const rest=state.src.slice(state.pos),note=/^\[\^([^\]\n]+)\]/.exec(rest)
  if(note){if(!silent){const token=state.push('footnote_reference','sup',0);token.content=note[1]}state.pos+=note[0].length;return true}
  if(rest[0]!=='$'||rest[1]==='$')return false
  let end=1;while((end=rest.indexOf('$',end))>=0){if(rest[end-1]!=='\\')break;end++}
  if(end<1||rest.slice(1,end).includes('\n'))return false
  if(!silent){const token=state.push('math_inline','span',0);token.content=rest.slice(1,end)}state.pos+=end+1;return true
})
// Task syntax becomes a real list-item attribute. No checkbox state lives only in DOM.
tokenizer.core.ruler.after('inline','lightedit_tasks', state => {
  const stack: typeof state.tokens = []
  for (const token of state.tokens) {
    if(token.type==='list_item_open') stack.push(token)
    if(token.type==='list_item_close') stack.pop()
    if(token.type!=='inline' || !stack.length) continue
    const first=token.children?.[0], match=first?.type==='text' && /^\[([ xX])\] /.exec(first.content)
    if(match){stack[stack.length-1].meta={checked:match[1]!==' '};first!.content=first!.content.slice(match[0].length)}
  }
})
tokenizer.core.ruler.after('lightedit_tasks','lightedit_cells', state=>{
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
export function parseMarkdown(source:string, referenceEnvironment:Record<string,unknown> = {}) {
  const starts=[0]; for(let i=0;i<source.length;i++)if(source[i]==='\n')starts.push(i+1)
  const yaml=/^---\n[\s\S]*?\n(?:---|\.\.\.)(?:\n|$)/.exec(source)
  const scan=yaml ? yaml[0].replace(/[^\n]/g,' ') + source.slice(yaml[0].length) : source
  const env: Record<string, unknown> = { ...referenceEnvironment, references: { ...referenceEnvironment.references as object } }
  const parsed=tokenizer.parse(scan,env)
  const ranges:{from:number;to:number;raw?:boolean;label?:string}[]=[]
  if(yaml)ranges.push({from:0,to:yaml[0].replace(/\n$/,'').length,raw:true,label:'YAML Front Matter'})
  let level=0
  for(const token of parsed){
    if(level===0 && token.map){
      let to=starts[token.map[1]] ?? source.length
      while(to>(starts[token.map[0]]||0) && source[to-1]==='\n'){
        to--
        if(source[to-1]==='\r')to--
      }
      ranges.push({from:starts[token.map[0]],to,raw:token.type==='html_block',label:'HTML（安全源码）'})
    }
    level+=token.nesting
  }
  ranges.sort((a,b)=>a.from-b.from)
  const blocks:SourceBlock[]=[]; let cursor=0
  const add=(from:number,to:number,raw:boolean,label='扩展语法（保留源码）')=>{
    const original=source.slice(from,to),id=`md-${++identity}`
    let node:Node
    try {
      const complex=raw || /(^|\n)(?:\[\^[^\]]+\]:|\$\$|\[toc\]|:::+|>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])/i.test(original)
      if(complex) node=s.nodes.protected_source.create({source:original,label})
      else {
        node=markdownParser.parse(original,env).firstChild!
        if(!node)node=s.nodes.protected_source.create({source:original,label})
      }
    }catch{node=s.nodes.protected_source.create({source:original,label})}
    node=node.type.create({...node.attrs,sourceId:id},node.content,node.marks)
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
