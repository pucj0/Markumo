import { syntaxTree } from '@codemirror/language'
import type { EditorState, Text } from '@codemirror/state'
import type { EditorDocument } from '../../types'

export interface OutlineItem {
  id: string; name: string; level: number; lineNumber: number
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
      if (/^(ATXHeading|SetextHeading)[1-6]$/.test(node.name)) {
        const name = text.lineAt(node.from).text.replace(/^\s*#{1,6}\s+/, '').replace(/\s+#+\s*$/, '').trim()
        items.push({ id: `h-${node.from}`, name, level: Number(node.name.at(-1)), lineNumber: text.lineAt(node.from).number, kind: 'heading' })
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
