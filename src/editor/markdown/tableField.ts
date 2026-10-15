import { StateField, StateEffect, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { tableModel } from './tableModel'
import { TableWidget } from './tableWidget'

const composing = StateEffect.define<boolean>()
function build(state: EditorState): DecorationSet {
  if (state.doc.length > 1024 * 1024) return Decoration.none
  const ranges: ReturnType<Decoration['range']>[] = []
  let count = 0
  syntaxTree(state).iterate({ enter(node) {
    if (node.name !== 'Table') return
    if (++count > 200) return false
    const model = tableModel(state, node.node)
    if (!model) return false
    if (state.selection.ranges.some(range => range.from <= model.to && range.to >= model.from)) {
      for (let number = state.doc.lineAt(model.from).number; number <= state.doc.lineAt(model.to).number; number++)
        ranges.push(Decoration.line({ class: 'cm-md-table-source' }).range(state.doc.line(number).from))
    } else ranges.push(Decoration.replace({ block: true, widget: new TableWidget(model) }).range(model.from, model.to))
    return false
  } })
  return Decoration.set(ranges, true)
}
/** Direct decoration source: CM measures multi-line block replacements itself. */
export const tableField = StateField.define<{ decorations: DecorationSet; composing: boolean }>({
  create: state => ({ decorations: build(state), composing: false }),
  update(value, transaction) {
    const effect = transaction.effects.find(effect => effect.is(composing))
    const ime = effect ? effect.value : value.composing
    if (ime) return { composing: true, decorations: value.decorations.map(transaction.changes) }
    if (effect || transaction.docChanged || transaction.selection || syntaxTree(transaction.state) !== syntaxTree(transaction.startState))
      return { composing: false, decorations: build(transaction.state) }
    return value
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
})
export const tableComposition = ViewPlugin.fromClass(class {
  timer: ReturnType<typeof setTimeout> | undefined
  constructor(readonly view: EditorView) {}
  start() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.view.dispatch({ effects: composing.of(true) }) }
  end() { this.timer = setTimeout(() => { this.timer = undefined; if (this.view.compositionStarted) this.end(); else this.view.dispatch({ effects: composing.of(false) }) }, 30) }
  destroy() { if (this.timer) clearTimeout(this.timer) }
}, { eventHandlers: { compositionstart() { this.start(); return false }, compositionend() { this.end(); return false } } })
