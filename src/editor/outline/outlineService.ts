import { syntaxTree } from '@codemirror/language'
import type { EditorState, Text } from '@codemirror/state'
import type { EditorDocument } from '../../types'
import { htmlLanguage } from '@codemirror/lang-html'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const inlineMarkdown=new MarkdownIt({html:false,linkify:false})
// A Live pane has no CodeMirror viewport to advance its incremental parser.
// Tokenize Markdown independently so headings after the initial parse budget
// remain available. This parser only inspects tokens; HTML is never mounted.
const outlineMarkdown=new MarkdownIt({html:true,linkify:false})
// Outline rows navigate the editor. Titles must not add nested links, images,
// event handlers or remote requests inside those navigation buttons.
inlineMarkdown.renderer.rules.link_open=inlineMarkdown.renderer.rules.link_close=()=>''
inlineMarkdown.renderer.rules.image=(tokens,index)=>inlineMarkdown.utils.escapeHtml(tokens[index].content)
inlineMarkdown.renderer.rules.softbreak=()=> ' '
const unescapeHtml=inlineMarkdown.utils.unescapeAll
function headingLabel(source:string){
  const labelHtml=DOMPurify.sanitize(inlineMarkdown.renderInline(source),{ALLOWED_TAGS:['strong','em','s','code','br'],ALLOWED_ATTR:[]})
  return {name:unescapeHtml(labelHtml.replace(/<[^>]*>/g,'')),labelHtml}
}

export interface OutlineItem {
  id: string; name: string; level: number; lineNumber: number
  from?:number; to?:number
  labelHtml?:string
  kind?: 'heading' | 'function' | 'class' | 'interface' | 'struct' | 'enum' | 'type'
}
const cache = new WeakMap<Text, { tree: ReturnType<typeof syntaxTree>; markdown: boolean; items: OutlineItem[] }>()
function markdownOutline(text: Text): OutlineItem[] {
  const tokens = outlineMarkdown.parse(text.toString(), {}), items: OutlineItem[] = []
  for (let index = 0; index < tokens.length && items.length < 1000; index++) {
    const token = tokens[index]
    if (!token.map) continue
    const line = text.line(token.map[0] + 1)
    if (token.type === 'heading_open') {
      const source = tokens[index + 1]?.content || ''
      const end = text.line(Math.min(text.lines, token.map[1])).to
      items.push({id:`h-${line.from}`, ...headingLabel(source), level:Number(token.tag.slice(1)), lineNumber:line.number, from:line.from, to:end, kind:'heading'})
    } else if (token.type === 'html_block') {
      const end = token.map[1] < text.lines ? text.line(token.map[1] + 1).from : text.length
      const raw = text.sliceString(line.from, end)
      htmlLanguage.parser.parse(raw).iterate({enter(node){
        if(node.name !== 'Element')return
        const open=node.node.getChild('OpenTag'), tag=open?.getChild('TagName')
        const name=tag&&raw.slice(tag.from,tag.to).toLowerCase()
        if(name&&/^(script|style|template|iframe|object)$/.test(name))return false
        if(!name||!/^h[1-6]$/.test(name)||!open||items.length>=1000)return
        const close=node.node.getChild('CloseTag'), from=line.from+node.from
        items.push({id:`h-${from}`,name:unescapeHtml(raw.slice(open.to,close?.from??node.to).replace(/<[^>]*>/g,'')).trim(),level:Number(name[1]),lineNumber:text.lineAt(from).number,from,to:line.from+node.to,kind:'heading'})
        return false
      }})
    }
  }
  return items
}
export function extractOutline(doc: EditorDocument | null, state: EditorState | undefined): OutlineItem[] {
  if (!doc || !state || doc.languageStatus !== 'ready' || state.doc.length > 1024 * 1024) return []
  const markdown = /\.(md|markdown)$/i.test(doc.name), tree = syntaxTree(state), text = state.doc
  const cached = cache.get(text)
  if (cached?.markdown === markdown && (markdown || cached.tree === tree)) return cached.items
  if (markdown) {
    const items=markdownOutline(text)
    cache.set(text,{tree,markdown,items})
    return items
  }
  const items: OutlineItem[] = []
  tree.iterate({ enter(node) {
    if (items.length >= 1000) return false
    if (/^(FunctionDeclaration|FunctionDefinition|MethodDeclaration|ClassDeclaration|ClassDefinition|InterfaceDeclaration|TypeAliasDeclaration|StructItem|EnumItem|FunctionItem|FnItem|TraitItem)$/.test(node.name)) {
      const nameNode = node.node.getChild('VariableDefinition') || node.node.getChild('VariableName') || node.node.getChild('TypeName') || node.node.getChild('Identifier') || node.node.getChild('PropertyDefinition') || node.node.getChild('Name')
      if (nameNode) {
        const kind: OutlineItem['kind'] = /Class/.test(node.name) ? 'class' : /Interface|Trait/.test(node.name) ? 'interface' : /Struct/.test(node.name) ? 'struct' : /Enum/.test(node.name) ? 'enum' : /TypeAlias/.test(node.name) ? 'type' : 'function'
        items.push({ id: `sym-${node.from}`, name: text.sliceString(nameNode.from, nameNode.to), level: 1, lineNumber: text.lineAt(node.from).number, kind })
      }
    }
  } })
  cache.set(text, { tree, markdown, items })
  return items
}
