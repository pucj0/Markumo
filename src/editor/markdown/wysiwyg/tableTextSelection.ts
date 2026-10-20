import type { Node } from 'prosemirror-model'
import { Plugin, TextSelection, type EditorState, type Selection, type Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { CellSelection, tableEditing } from 'prosemirror-tables'

/**
 * `tableEditing()` from prosemirror-tables turns a normal mouse drag across
 * cells into a `CellSelection`, which is right for a spreadsheet but wrong for
 * a text editor: selecting part of one cell and dragging into the next cell
 * stops being a normal text selection.
 *
 * Markumo keeps the plugin (table normalization, keyboard navigation, paste,
 * structural CellSelection drawing) and only replaces the three mouse-related
 * entry points:
 *
 * 1. plain left mousedown in a cell is left to ProseMirror's native text
 *    selection instead of installing the plugin's mousemove-to-CellSelection
 *    listener;
 * 2. triple click falls through to the normal textblock selection;
 * 3. starting a native drag from selected table text is blocked (otherwise the
 *    browser drops a table fragment and can corrupt the table);
 * 4. a cross-cell TextSelection that the plugin would collapse at a cell
 *    boundary is restored.
 *
 * Structural selection remains available through the table toolbar. Shift+click
 * on an existing structural CellSelection still extends it by cells.
 */

const RESTORED_TEXT_SELECTION = 'markumoTextFirstSelection'

function cellRangeAt(doc: Node, pos: number): { from: number; to: number } | null {
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth--) {
    const role = $pos.node(depth).type.spec.tableRole
    if (role === 'cell' || role === 'header_cell') {
      return { from: $pos.before(depth), to: $pos.after(depth) }
    }
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

function isCellTarget(view: EditorView, target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('td,th') && view.dom.contains(target)
}

function selectionTouchesCell(selection: Selection): boolean {
  if (!(selection instanceof TextSelection)) return false
  return !!(
    cellRangeAt(selection.$from.doc, selection.$from.pos) ||
    cellRangeAt(selection.$to.doc, selection.$to.pos)
  )
}

export function textFirstTableEditing(): Plugin {
  const plugin = tableEditing()
  const baseMouseDown = plugin.props.handleDOMEvents?.mousedown as
    | ((view: EditorView, event: Event) => boolean)
    | undefined
  const baseDragStart = plugin.props.handleDOMEvents?.dragstart as
    | ((view: EditorView, event: Event) => boolean)
    | undefined
  const baseAppend = plugin.spec.appendTransaction

  plugin.props.handleDOMEvents = {
    ...plugin.props.handleDOMEvents,
    mousedown(view, event) {
      const mouse = event as MouseEvent
      // An existing structural selection is the one case where shift+click is
      // expected to extend by cells. Every other left drag in a cell belongs to
      // normal text selection, including shift+click on a TextSelection.
      const structuralShift = mouse.shiftKey && view.state.selection instanceof CellSelection
      if (
        mouse.button === 0 &&
        !mouse.ctrlKey &&
        !mouse.metaKey &&
        !structuralShift &&
        isCellTarget(view, mouse.target)
      ) {
        // Returning false lets ProseMirror's own mousedown/drag selection run
        // without the table plugin's CellSelection mousemove listener.
        return false
      }
      return baseMouseDown ? baseMouseDown.call(plugin, view, event) : false
    },
    dragstart(view, event) {
      // A second drag starting inside an existing text selection would become a
      // native drag-and-drop of a table fragment and can corrupt the table. A
      // text editor should start a new text selection instead. The event target
      // for a contenteditable text drag is not necessarily the cell element, so
      // decide from the selection positions.
      if (!view.state.selection.empty && selectionTouchesCell(view.state.selection)) {
        event.preventDefault()
        return true
      }
      return baseDragStart ? baseDragStart.call(plugin, view, event) : false
    },
  }

  // A triple click in a text editor selects the text block. The table plugin's
  // default selects the whole cell; the toolbar owns structural selection.
  plugin.props.handleTripleClick = () => false

  if (baseAppend) {
    plugin.spec.appendTransaction = (
      transactions: readonly Transaction[],
      oldState: EditorState,
      newState: EditorState,
    ) => {
      // Our own restoration transaction must not be normalized again, otherwise
      // appendTransaction would loop forever between collapse and restore.
      if (transactions.some(transaction => transaction.getMeta(RESTORED_TEXT_SELECTION))) return null
      const before = newState.selection
      const result = baseAppend.call(plugin, transactions, oldState, newState)
      if (!result || !(before instanceof TextSelection) || !crossesTableCells(before)) return result
      // Only a pure selection transaction is restored. A document edit or a
      // structural transaction must keep its own selection.
      if (transactions.some(transaction => transaction.docChanged)) return result
      if (!(result.selection instanceof TextSelection) || crossesTableCells(result.selection)) return result
      try {
        const restored = before.map(result.doc, result.mapping)
        if (restored instanceof TextSelection && crossesTableCells(restored)) {
          result.setSelection(restored).setMeta(RESTORED_TEXT_SELECTION, true)
        }
      } catch {
        // If mapping makes the old selection invalid, keep the plugin's
        // normalization rather than dispatching an invalid selection.
      }
      return result
    }
  }

  return plugin
}
