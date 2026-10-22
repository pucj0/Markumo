import { MarkdownSerializer, defaultMarkdownSerializer } from 'prosemirror-markdown'
import type { Node } from 'prosemirror-model'
import { markdownSchema } from './MarkdownSchema'
import { tableRow } from '../tableModel'

export const markdownSerializer = new MarkdownSerializer({ ...defaultMarkdownSerializer.nodes,
  soft_break(state){state.write('\n')},
  math_inline(state,node){state.write('$'+node.attrs.latex+'$')},
  footnote_reference(state,node){state.write('[^'+node.attrs.label+']')},
  html_block(state,node){state.write(node.attrs.source);state.closeBlock(node)},
  html_inline(state,node){state.write(node.attrs.source)},
  protected_source(state,node){state.write(node.attrs.source);state.closeBlock(node)},
  toc(state, node) {
    state.write(node.attrs.raw || '[TOC]')
    state.closeBlock(node)
  },
  callout(state, node) {
    const type = (node.attrs.calloutType || 'NOTE').toUpperCase()
    const title = node.attrs.title ? ` ${node.attrs.title}` : ''
    state.wrapBlock('> ', null, node, () => {
      state.write(`[!${type}]${title}\n`)
      state.renderContent(node)
    })
    state.closeBlock(node)
  },
  list_item(state,node){if(node.attrs.checked!==null)state.write(node.attrs.checked?'[x] ':'[ ] ');state.renderContent(node)},
  code_block(state,node){
    const char=node.attrs.fence?.[0]==='~'||String(node.attrs.params).includes('`')?'~':'`'
    let length=Math.max(3,node.attrs.fence?.length||3)
    for(const match of node.textContent.matchAll(new RegExp(`${char==='`'?'`':'~'}{3,}`,'g')))length=Math.max(length,match[0].length+1)
    const fence=char.repeat(length)
    state.write(fence+node.attrs.params+'\n');state.text(node.textContent,false);state.write('\n'+fence);state.closeBlock(node)
  },
  table(state,node){state.write(serializeTable(node));state.closeBlock(node)},
}, {...defaultMarkdownSerializer.marks,strike:{open:'~~',close:'~~',mixable:true,expelEnclosingWhitespace:true}})
export function serializeBlock(node:Node){return markdownSerializer.serialize(markdownSchema.nodes.doc.create(null,node))}
export function serializeCell(node:Node){return markdownSerializer.serialize(markdownSchema.nodes.doc.create(null,node.content)).replace(/\\\n/g,'<br>').replace(/\n/g,'<br>').replace(/\|/g,'\\|')}
export function serializeTable(node:Node){
  const lines:string[]=[]
  node.forEach((row,_,i)=>{
    const cells:string[]=[];row.forEach(cell=>{if(cell.attrs.colspan!==1||cell.attrs.rowspan!==1)throw new Error('GFM 不支持合并单元格');cells.push(serializeCell(cell))})
    lines.push('| '+cells.join(' | ')+' |')
    if(i===0){const align:string[]=[];row.forEach(cell=>align.push(cell.attrs.align==='center'?':---:':cell.attrs.align==='right'?'---:':cell.attrs.align==='left'?':---':'---'));lines.push('| '+align.join(' | ')+' |')}
  });return lines.join('\n')
}
/** Preserve the whitespace, delimiters, and untouched inline formatting of every
 * cell when the table shape has not changed. Structural operations serialize
 * only this table, never the surrounding document. */
export function patchTable(old:Node,next:Node,raw:string):string|null {
  if(old.childCount!==next.childCount)return null
  const lines=raw.split('\n'), offsets:number[]=[];let at=0
  for(const line of lines){offsets.push(at);at+=line.length+1}
  const patches:{from:number;to:number;insert:string}[]=[]
  for(let r=0;r<old.childCount;r++){
    const a=old.child(r),b=next.child(r),line=r===0?0:r+1
    if(a.childCount!==b.childCount||!lines[line])return null
    const cells=tableRow(lines[line],offsets[line]).cells
    if(cells.length!==a.childCount)return null
    for(let c=0;c<a.childCount;c++){
      if(a.child(c).eq(b.child(c)))continue
      if(!a.child(c).sameMarkup(b.child(c)))return null
      patches.push({...cells[c],insert:serializeCell(b.child(c))})
    }
  }
  for(const p of patches.reverse())raw=raw.slice(0,p.from)+p.insert+raw.slice(p.to)
  return raw
}
