import MarkdownIt from 'markdown-it'
import { classHighlighter, highlightTree } from '@lezer/highlight'
import { LanguageSupport } from '@codemirror/language'
import { detectLanguage, languageNames, loadLanguage, type LanguageName } from '../languages'
import { parser } from '@lezer/markdown'
import { imageDestination } from './images'
import { markdownSemantics, markdownSyntaxExtensions } from './semantics'
const imageParser=parser.configure(markdownSyntaxExtensions)

// Shared semantics: GFM tables/tasks, literal punctuation, visible soft line breaks,
// no raw HTML and no renderer-created network/file resource URLs.
export { markdownSemantics } from './semantics'
export function fenceLanguage(info: string): LanguageName {
  const label = info.trim().split(/\s+/)[0]
  return languageNames.find(name => name.toLowerCase() === label.toLowerCase()) || detectLanguage(`code.${label}`)
}
export function createMarkdownRenderer(onLanguageReady: () => void = () => {}) {
  const md = new MarkdownIt(markdownSemantics)
  const languages = new Map<LanguageName, LanguageSupport | null>()
  const pending = new Set<LanguageName>()
  md.options.highlight = (code, info) => {
    const language = fenceLanguage(info)
    if (code.length > 64 * 1024 || ['Markdown','Plain Text','CSV','Log'].includes(language)) return ''
    if (!languages.has(language) && !pending.has(language)) {
      pending.add(language)
      void loadLanguage(language).then(support => { languages.set(language,support instanceof LanguageSupport ? support : null) },()=>languages.set(language,null)).finally(()=>{pending.delete(language);onLanguageReady()})
    }
    const support = languages.get(language)
    if (!support) return ''
    let result = '', position = 0
    highlightTree(support.language.parser.parse(code), classHighlighter, (from,to,classes) => {
      result += md.utils.escapeHtml(code.slice(position,from)) + `<span class="${classes}">${md.utils.escapeHtml(code.slice(from,to))}</span>`; position = to
    })
    return result + md.utils.escapeHtml(code.slice(position))
  }
  md.core.ruler.after('inline','lightedit-semantics', state => {
    const images:{source:string;from:number}[]=[]
    if(state.src.length<=1024*1024)imageParser.parse(state.src).iterate({enter(node){
      if(['FencedCode','CodeBlock','Table'].includes(node.name))return false
      if(node.name==='Image'){
        const url=node.node.getChild('URL')
        if(url&&images.length<64)images.push({source:state.src.slice(url.from,url.to),from:node.from})
        return false
      }
    }})
    let imageIndex=0
    let listDepth=0, tableDepth=0
    for (const token of state.tokens) {
      if (token.type==='list_item_open') listDepth++
      if (token.type==='list_item_close') listDepth--
      if (token.type==='table_open') tableDepth++
      if (token.type==='table_close') tableDepth--
      if (token.type!=='inline') continue
      const first=token.children?.[0]
      if (listDepth>0 && first?.type==='text' && /^\[[ xX]\]\s/.test(first.content)) {
        const check = new state.Token('lightedit_task','input',0)
        check.meta={checked:/^\[[xX]\]/.test(first.content)}
        first.content=first.content.slice(4);token.children!.unshift(check)
      }
      for (const child of token.children || []) if (child.type==='image') {
        const candidate=images[imageIndex],source=String(child.attrGet('src')||'')
        const match=tableDepth===0&&candidate&&imageDestination(candidate.source).path===imageDestination(source).path
        child.meta={from:match?candidate.from:undefined,inTable:tableDepth>0}
        if(match)imageIndex++
      }
    }
  })
  md.renderer.rules.lightedit_task=(tokens,index)=>`<input class="md-preview-task" type="checkbox" disabled aria-label="${tokens[index].meta?.checked?'已完成任务':'待办任务'}"${tokens[index].meta?.checked?' checked':''}>`
  md.renderer.rules.image=(tokens,index)=> {
    const token=tokens[index],source=String(token.attrGet('src')||''),alt=token.content
    if(token.meta?.inTable||typeof token.meta?.from!=='number')return md.utils.escapeHtml(`![${alt}](${source})`)
    return `<span class="md-image-slot" data-md-source="${md.utils.escapeHtml(source)}" data-md-alt="${md.utils.escapeHtml(alt)}" data-source-from="${token.meta.from}"></span>`
  }
  const fence=md.renderer.rules.fence!
  md.renderer.rules.fence=(tokens,index,options,env,self)=>`<div class="md-preview-fence"><div class="md-preview-fence-header"><span>${md.utils.escapeHtml(tokens[index].info.trim()||'text')}</span><button type="button" data-md-copy>复制代码</button></div>${fence(tokens,index,options,env,self)}</div>`
  return md
}
