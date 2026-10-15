import { StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { blockComposing } from './tableField'
import { markdownResources, mountMarkdownImage, refreshMarkdownResources } from './images'

const mounts = new WeakMap<HTMLElement, ReturnType<typeof mountMarkdownImage>>()
class ImageWidget extends WidgetType {
  constructor(readonly source: string, readonly alt: string, readonly block: boolean, readonly offset: number,readonly resourceKey:string) { super() }
  eq(other: ImageWidget) { return this.source === other.source && this.alt === other.alt && this.block === other.block && this.offset === other.offset && this.resourceKey===other.resourceKey }
  get estimatedHeight() { return this.block ? 220 : 90 }
  toDOM(view: EditorView) {
    const host = document.createElement(this.block ? 'div' : 'span')
    host.className = this.block ? 'cm-md-image-block' : 'cm-md-image-inline'
    const edit = () => {
      if (view.compositionStarted) return
      const position = view.posAtDOM(host) + this.offset
      view.dispatch({ selection: { anchor: position }, scrollIntoView: true }); view.focus(); view.requestMeasure()
    }
    host.onmousedown = event => { event.preventDefault(); event.stopPropagation() }
    mounts.set(host, mountMarkdownImage(host, this.source, this.alt, view.state.facet(markdownResources), edit, () => view.requestMeasure()))
    return host
  }
  destroy(dom: HTMLElement) { mounts.get(dom)?.destroy(); mounts.delete(dom) }
  ignoreEvent() { return true }
}
function build(state: EditorState): DecorationSet {
  if (state.doc.length > 1024 * 1024) return Decoration.none
  const ranges: ReturnType<Decoration['range']>[] = []; let count = 0
  syntaxTree(state).iterate({ enter(node) {
    if (['Table','FencedCode','CodeBlock'].includes(node.name)) return false
    if (node.name !== 'Image') return
    if (++count > 64) return false
    const url = node.node.getChild('URL'), marks = node.node.getChildren('LinkMark')
    // Reference images remain editable source until resolution is implemented.
    if (!url || marks.length < 2 || state.selection.ranges.some(range => range.from <= node.to && range.to >= node.from)) return false
    const line = state.doc.lineAt(node.from)
    if (state.doc.lineAt(node.to).number !== line.number) return false
    const source = state.sliceDoc(url.from, url.to), alt = state.sliceDoc(marks[0].to, marks[1].from)
    const block = line.text.trim() === state.sliceDoc(node.from, node.to)
    ranges.push(Decoration.replace({ block, widget: new ImageWidget(source, alt, block, block ? node.from-line.from : 0,state.facet(markdownResources).identity()) }).range(block ? line.from : node.from, block ? line.to : node.to))
    return false
  } })
  return Decoration.set(ranges, true)
}
// Block replacements must be provided directly by StateField, never a ViewPlugin.
export const imageField = StateField.define<{ decorations: DecorationSet; composing: boolean }>({
  create: state => ({ decorations: build(state), composing: false }),
  update(value, transaction) {
    const effect = transaction.effects.find(effect => effect.is(blockComposing))
    const composing = effect ? effect.value : value.composing
    if (composing) return { composing, decorations: value.decorations.map(transaction.changes) }
    if (effect || transaction.effects.some(effect=>effect.is(refreshMarkdownResources)) || transaction.docChanged || transaction.selection || syntaxTree(transaction.state) !== syntaxTree(transaction.startState)) return { composing, decorations: build(transaction.state) }
    return value
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
})
