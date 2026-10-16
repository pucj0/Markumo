import { syntaxTree } from '@codemirror/language'
import type { EditorState, Text } from '@codemirror/state'
import type { EditorDocument } from '../../types'
import { htmlLanguage } from '@codemirror/lang-html'
import MarkdownIt from 'markdown-it'

const unescapeHtml=new MarkdownIt().utils.unescapeAll

export interface OutlineItem {
  id: string; name: string; level: number; lineNumber: number
  from?:number; to?:number
  kind?: 'heading' | 'function' | 'class' | 'interface' | 'struct' | 'enum' | 'type'
}
const cache = new WeakMap<Text, { tree: ReturnType<typeof syntaxTree>; markdown: boolean; items: OutlineItem[] }>()
export function extractOutline(doc: EditorDocument | null, state: EditorState | undefined): OutlineItem[] {
  if (!doc || !state || doc.languageStatus !== 'ready' || state.doc.length > 1024 * 1024) return []
  const markdown = /\.(md|markdown)$/i.test(doc.name), tree = syntaxTree(state), text = state.doc
  const cached = cache.get(text)
  if (cached?.tree === tree && cached.markdown === markdown) return cached.items
  const items: OutlineItem[] = []
  tree.iterate({ enter(node) {
    if (items.length >= 1000) return false
    if (markdown) {
      if (/^(FencedCode|CodeBlock)$/.test(node.name)) return false
      if(node.name==='HTMLBlock'){
        const raw=text.sliceString(node.from,node.to)
        htmlLanguage.parser.parse(raw).iterate({enter(htmlNode){
          if(htmlNode.name!=='Element')return
          const open=htmlNode.node.getChild('OpenTag'),tag=open?.getChild('TagName')
          const tagName=tag&&raw.slice(tag.from,tag.to).toLowerCase()
          if(tagName&&/^(script|style|template|iframe|object)$/.test(tagName))return false
          if(!tagName||!/^h[1-6]$/.test(tagName)||!open||items.length>=1000)return
          const close=htmlNode.node.getChild('CloseTag')
          const name=unescapeHtml(raw.slice(open.to,close?.from??htmlNode.to).replace(/<[^>]*>/g,'')).trim()
          const from=node.from+htmlNode.from,to=node.from+htmlNode.to
          items.push({id:`h-${from}`,name,level:Number(tagName[1]),lineNumber:text.lineAt(from).number,from,to,kind:'heading'})
          return false
        }})
        return false
      }
      if (/^(ATXHeading|SetextHeading)[1-6]$/.test(node.name)) {
        const name = text.lineAt(node.from).text.replace(/^\s*#{1,6}\s+/, '').replace(/\s+#+\s*$/, '').trim()
        items.push({ id: `h-${node.from}`, name, level: Number(node.name.at(-1)), lineNumber: text.lineAt(node.from).number, from:node.from,to:node.to,kind: 'heading' })
        return false
      }
    } else if (/^(FunctionDeclaration|FunctionDefinition|MethodDeclaration|ClassDeclaration|ClassDefinition|InterfaceDeclaration|TypeAliasDeclaration|StructItem|EnumItem|FunctionItem|FnItem|TraitItem)$/.test(node.name)) {
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
