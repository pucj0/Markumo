import { parser } from '@lezer/markdown'
import { markdownSyntaxExtensions } from '../semantics'

const syntax = parser.configure(markdownSyntaxExtensions)
const voidTags = new Set(['img','br','hr','input','meta','link','area','base','col','embed','param','source','track','wbr'])
/** UTF-16 ranges from Markdown syntax, excluding tags in code/escaped text.
 * Paired HTML is kept verbatim, including Markdown delimiters and entities. */
export function inlineHtmlRanges(source:string) {
  const tags:{from:number;to:number;name:string;closing:boolean;void:boolean}[]=[]
  syntax.parse(source).iterate({enter(node){
    if (!['HTMLTag','Comment','ProcessingInstruction'].includes(node.name)) return
    const raw=source.slice(node.from,node.to), match=/^<(\/?)([\w-]+)/.exec(raw)
    tags.push({from:node.from,to:node.to,name:match?.[2].toLowerCase()||'',closing:match?.[1]==='/',void:!match||voidTags.has(match[2].toLowerCase())||/\/\s*>$/.test(raw)})
    return false
  }})
  const ranges:{from:number;to:number}[]=[]
  for(let i=0;i<tags.length;i++) {
    const tag=tags[i]
    if(!tag.closing&&!tag.void) {
      let depth=1,end=-1
      for(let j=i+1;j<tags.length;j++) if(tags[j].name===tag.name&&!tags[j].void) {
        depth+=tags[j].closing?-1:1
        if(!depth){end=j;break}
      }
      if(end>=0){ranges.push({from:tag.from,to:tags[end].to});i=end;continue}
    }
    ranges.push({from:tag.from,to:tag.to})
  }
  return ranges
}
