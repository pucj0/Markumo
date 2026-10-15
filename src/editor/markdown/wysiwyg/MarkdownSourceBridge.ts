import type { Node } from 'prosemirror-model'
import { parseMarkdown, type SourceBlock } from './MarkdownParser'
import { patchTable, serializeBlock } from './MarkdownSerializer'
export interface SourcePatch { from:number;to:number;insert:string }
export function textPatch(before:string,after:string):SourcePatch|null {
  if(before===after)return null
  let from=0,to=before.length,end=after.length
  while(from<to&&from<end&&before[from]===after[from])from++
  // Do not split UTF-16 surrogate pairs when constructing CM changes.
  if(from && /[\uD800-\uDBFF]/.test(before[from-1]))from--
  while(to>from&&end>from&&before[to-1]===after[end-1]){to--;end--}
  if(to<before.length&&to>0&&/[\uD800-\uDBFF]/.test(before[to-1])){to++;end++}
  return {from,to,insert:after.slice(from,end)}
}
export class MarkdownSourceBridge {
  source:string; doc:Node; blocks:SourceBlock[]; tail:string
  constructor(source:string){this.source=source;const parsed=parseMarkdown(source);this.doc=parsed.doc;this.blocks=parsed.blocks;this.tail=parsed.tail}
  /** Prepare without mutating; commit only after the canonical document accepts
   * the patch against the exact expected source revision. */
  prepare(doc:Node){
    const byId=new Map(this.blocks.map(b=>[b.id,b])),used=new Set<string>(),blocks:SourceBlock[]=[]
    let source=''
    doc.forEach(node=>{
      const id=node.attrs.sourceId as string,old=id&&!used.has(id)?byId.get(id):undefined
      if(id)used.add(id)
      const raw=old?.node.eq(node)?old.raw:old&&node.type.name==='table'&&old.node.type===node.type?(patchTable(old.node,node,old.raw)??serializeBlock(node)):serializeBlock(node)
      const prefix=old?old.prefix||(blocks.length&&!raw.startsWith('\n')?'\n\n':''):blocks.length?'\n\n':''
      source+=prefix;const from=source.length;source+=raw
      blocks.push({id,from,to:source.length,raw,prefix,node})
    })
    source+=this.tail
    const patch=textPatch(this.source,source)
    return {source,patch,commit:()=>{this.source=source;this.doc=doc;this.blocks=blocks}}
  }
  sourcePosition(pos:number){
    let offset=0
    for(const b of this.blocks){if(pos<=offset+b.node.nodeSize){
      const local=Math.max(0,pos-offset-1)
      if(b.node.type.name==='code_block'){const opening=/^ {0,3}(?:`{3,}|~{3,})[^\n]*\n/.exec(b.raw);return Math.min(b.to,b.from+(opening?.[0].length||0)+local)}
      const mapped=inlineSourcePosition(b.node,b.raw,local)
      return Math.min(b.to,b.from+mapped)
    }offset+=b.node.nodeSize}
    return this.source.length
  }
  documentPosition(sourcePos:number){
    let offset=0
    for(const b of this.blocks){if(sourcePos<=b.to){
      let local=Math.max(0,sourcePos-b.from)
      if(b.node.type.name==='code_block'){const opening=/^ {0,3}(?:`{3,}|~{3,})[^\n]*\n/.exec(b.raw);local=Math.max(0,local-(opening?.[0].length||0))}
      return Math.min(offset+b.node.nodeSize-1,offset+1+local)
    }offset+=b.node.nodeSize}
    return Math.max(0,this.doc.content.size-1)
  }
}
function inlineSourcePosition(node:Node,raw:string,position:number){
  let cursor=0,result:number|undefined
  node.descendants((child,pos)=>{
    if(result!==undefined)return false
    if(child.isText){
      const text=child.text!,start=raw.indexOf(text,cursor)
      if(start>=0){if(position>=pos&&position<=pos+text.length)result=start+position-pos;cursor=start+text.length}
    }
  })
  return result??Math.min(raw.length,position)
}
