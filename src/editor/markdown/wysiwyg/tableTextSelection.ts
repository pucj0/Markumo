import type { Node } from 'prosemirror-model'
import { TextSelection, type Plugin, type Selection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { CellSelection, tableEditing } from 'prosemirror-tables'

/**
 * `tableEditing()` already implements the Typora-style hybrid we want:
 *
 * - a mousedown installs its mousemove listener but does not cancel the native
 *   text selection, so a drag that stays inside one cell remains a normal
 *   `TextSelection`;
 * - once the pointer crosses into another cell, the listener switches to a
 *   rectangular `CellSelection`;
 * - shift+click and triple click keep their structural table behavior.
 *
 * The only behavior we need to add is preventing the browser's native
 * drag-and-drop from starting on a selected table fragment. Without this guard
 * a second drag inside an existing selection can drop a table fragment back into
 * the document and corrupt the canonical Markdown source.
 */
export function tableEditingWithDragGuard(): Plugin {
  const plugin = tableEditing()
  const baseDragStart = plugin.props.handleDOMEvents?.dragstart as
    | ((view: EditorView, event: Event) => boolean)
    | undefined

  plugin.props.handleDOMEvents = {
    ...plugin.props.handleDOMEvents,
    dragstart(view, event) {
      if (selectionTouchesCell(view.state.selection)) {
        event.preventDefault()
        return true
      }
      return baseDragStart ? baseDragStart.call(plugin, view, event) : false
    },
  }
  return plugin
}

function cellRangeAt(doc: Node, pos: number): { from: number; to: number } | null {
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth--) {
    const role = $pos.node(depth).type.spec.tableRole
    if (role === 'cell' || role === 'header_cell') return { from: $pos.before(depth), to: $pos.after(depth) }
  }
  return null
}

/** True when a text selection starts and ends in different table cells. */
export function crossesTableCells(selection: Selection): boolean {
  if (!(selection instanceof TextSelection) || selection.empty) return false
  const from = cellRangeAt(selection.$from.doc, selection.$from.pos)
  const to = cellRangeAt(selection.$to.doc, selection.$to.pos)
  return !!from && !!to && from.from !== to.from
}

function selectionTouchesCell(selection: Selection): boolean {
  if (selection instanceof CellSelection) return true
  if (!(selection instanceof TextSelection)) return false
  return !!(
    cellRangeAt(selection.$from.doc, selection.$from.pos) ||
    cellRangeAt(selection.$to.doc, selection.$to.pos)
  )
}
