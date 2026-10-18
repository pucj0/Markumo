import { syntaxTree } from '@codemirror/language'
import { ViewPlugin, Decoration, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view'

/** Classify only parsed YAML value nodes, not keys, aliases, strings or comments.
 * No YAML parser is imported, so lazily loaded Markdown fences share this adapter. */
export function yamlScalarSpans(tree: ReturnType<typeof syntaxTree>, read: (from: number, to: number) => string,
  from = 0, to = tree.length) {
  const spans: {from: number; to: number; classes: string}[] = []
  const seen = new Set<string>()
  const collect = (current: typeof tree, offset: number) => current.iterate({from: Math.max(0, from - offset), to: to - offset, enter(node) {
    // Markdown mounts fence parsers as overlays, which ordinary tree iteration
    // does not enter. Resolve that overlay once per visible CodeText region.
    if (node.name === 'CodeText') {
      let inner: typeof tree.topNode | null = tree.resolveInner(Math.max(from, node.from + offset), 1)
      while (inner && !(inner.type.isTop && inner.name === 'Stream')) inner = inner.parent
      if (inner && inner.from >= node.from + offset && inner.to <= node.to + offset) collect(inner.toTree(), inner.from)
      return false
    }
    if (node.name !== 'Literal' || node.to <= node.from || node.node.parent?.name === 'Key' || node.node.parent?.name === 'Tagged' || node.to - node.from > 16384) return
    let ancestor = node.node.parent
    while (ancestor && !(ancestor.type.isTop && ancestor.name === 'Stream')) ancestor = ancestor.parent
    if (!ancestor) return
    const start = node.from + offset, end = node.to + offset, key = `${start}:${end}`
    if (seen.has(key)) return
    seen.add(key)
    const value = read(start, end)
    const role = /^(?:true|True|TRUE|false|False|FALSE)$/.test(value) ? 'boolean' : /^(?:null|Null|NULL|~)$/.test(value) ? 'null' :
      /^(?:0x[\da-fA-F]+|0o[0-7]+|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[+-]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/.test(value) ? 'number' : 'string'
    spans.push({from: start, to: end, classes: `mk-syntax-${role}`})
  }})
  collect(tree, 0)
  return spans
}

export const yamlScalarHighlight = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = this.build(view) }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = this.build(update.view)
  }
  build(view: EditorView) {
    const tree = syntaxTree(view.state)
    if (!['Stream', 'Document'].includes(tree.type.name)) return Decoration.none
    const ranges = view.visibleRanges.flatMap(({from, to}) => yamlScalarSpans(tree, (from, to) => view.state.sliceDoc(from, to), from, to))
    return Decoration.set(ranges.map(span => Decoration.mark({class: span.classes}).range(span.from, span.to)), true)
  }
}, {decorations: value => value.decorations})
