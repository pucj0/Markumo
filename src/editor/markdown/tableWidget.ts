import { WidgetType, type EditorView } from '@codemirror/view'
import { safeMarkdownURL, openMarkdownLink } from './links'
import { editTable, type TableBlockModel, type TableOperation, type InlineNode, type TableCell } from './tableModel'

/** A small AST-to-DOM renderer, never HTML, scripts, images or contenteditable. */
function inlineDOM(cell: TableCell, target: HTMLElement) {
  const text = cell.text
  const root: InlineNode = { name: 'TableCell', from: 0, to: text.length, children: cell.inline || [] }
  const render = (node: InlineNode, parent: HTMLElement) => {
    if (['Image','HTMLTag','HTMLBlock'].includes(node.name)) { parent.append(document.createTextNode(text.slice(node.from, node.to))); return }
    const tag = ({ StrongEmphasis: 'strong', Emphasis: 'em', Strikethrough: 's', InlineCode: 'code', Link: 'a' } as Record<string, string>)[node.name]
    const element = tag ? document.createElement(tag) : parent
    if (tag === 'a') {
      const url = node.children.find(child => child.name === 'URL'), safe = url && safeMarkdownURL(text.slice(url.from, url.to))
      if (safe) { element.setAttribute('href', safe); element.onclick = event => { event.preventDefault(); if (event.ctrlKey || event.metaKey) void openMarkdownLink(safe) } }
    }
    if (tag) parent.append(element)
    if (node.name === 'InlineCode') {
      const marks = node.children.filter(child => child.name === 'CodeMark')
      let code = marks.length >= 2 ? text.slice(marks[0].to, marks[marks.length - 1].from) : text.slice(node.from, node.to)
      if (code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1)
      element.textContent = code.replace(/\\\|/g, '|'); return
    }
    let position = node.from
    for (const child of node.children) {
      if (child.from > position) element.append(document.createTextNode(text.slice(position, child.from).replace(/\\([\\|*_[\]`])/g, '$1')))
      if (!['EmphasisMark','StrikethroughMark','CodeMark','LinkMark','URL','LinkTitle'].includes(child.name)) render(child, element)
      position = child.to
    }
    if (position < node.to) element.append(document.createTextNode(text.slice(position, node.to).replace(/\\([\\|*_[\]`])/g, '$1')))
  }
  render(root, target)
}
export class TableWidget extends WidgetType {
  private cleanup: (() => void) | null = null
  constructor(readonly model: TableBlockModel) { super() }
  eq(other: TableWidget) { return this.model.from === other.model.from && this.model.source === other.model.source }
  get estimatedHeight() { return 16 + this.model.rows.length * 34 }
  destroy() {
    this.cleanup?.()
    this.cleanup = null
  }
  toDOM(view: EditorView) {
    const wrapper = document.createElement('div'); wrapper.className = 'cm-md-table-block'
    const table = document.createElement('table'); table.className = 'cm-md-table'; table.setAttribute('aria-label', 'Markdown 表格，点击单元格编辑源码')
    const toolbar = document.createElement('div'); toolbar.className = 'cm-md-table-tools'
    let row = Math.min(1, this.model.rows.length - 1), column = 0
    const controls: [TableOperation, string][] = [['row-add','插入行'],['row-delete','删除行'],['column-add','插入列'],['column-delete','删除列']]
    for (const [operation, label] of controls) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.setAttribute('aria-label', label)
      button.disabled = view.state.readOnly || (operation === 'column-delete' && this.model.align.length === 1) || (operation === 'row-delete' && this.model.rows.length === 1)
      button.onmousedown = event => event.preventDefault()
      button.onclick = () => { if (view.compositionStarted || view.state.readOnly) return; const transaction = editTable(this.model, operation, row, column); if (transaction) { view.dispatch(transaction); view.focus() } }
      toolbar.append(button)
    }
    wrapper.append(toolbar, table)
    // A second mousedown inside an existing native selection would start a
    // native drag of the rendered table text. Collapse that selection first so
    // every drag starts a fresh text selection instead of a drag-and-drop.
    const clearNativeSelection = (event: MouseEvent) => {
      if (event.shiftKey) return
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed && selection.rangeCount > 0 && wrapper.contains(selection.getRangeAt(0).commonAncestorContainer)) {
        selection.removeAllRanges()
      }
    }
    const blockNativeDrag = (event: DragEvent) => {
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    wrapper.addEventListener('mousedown', clearNativeSelection, true)
    wrapper.addEventListener('dragstart', blockNativeDrag)
    // While a native drag selection is inside this widget, CodeMirror still
    // owns the editor selection and its copy handler would copy that selection
    // (usually the previous text caret) instead of the visible table text.
    const copySelection = (event: ClipboardEvent) => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !event.clipboardData) return
      const range = selection.getRangeAt(0)
      if (!wrapper.contains(range.commonAncestorContainer)) return
      event.clipboardData.setData('text/plain', selection.toString())
      const container = document.createElement('div')
      container.append(range.cloneContents())
      event.clipboardData.setData('text/html', container.innerHTML)
      event.preventDefault()
      event.stopPropagation()
      // A rendered widget cannot safely delete a partial Markdown source range.
      // Suppress CM's unrelated cut selection rather than corrupting the table.
    }
    wrapper.addEventListener('copy', copySelection)
    wrapper.addEventListener('cut', copySelection)
    this.model.rows.forEach((sourceRow, rowIndex) => {
      const tr = document.createElement('tr'); table.append(tr)
      sourceRow.cells.forEach((cell, columnIndex) => {
        const td = document.createElement(rowIndex === 0 ? 'th' : 'td'); td.style.textAlign = this.model.align[columnIndex]; td.dataset.sourceFrom = String(cell.from)
        inlineDOM(cell, td); if (!cell.text) td.append(document.createTextNode('\u00a0'))
        td.onmouseenter = () => { row = rowIndex; column = columnIndex }
        td.onmousedown = event => this.press(event, cell.from, view)
        tr.append(td)
      })
    })
    return wrapper
  }
  ignoreEvent() { return true }

  /**
   * A click still opens the source cell, but a drag must select the rendered
   * text instead of being swallowed by `preventDefault` on mousedown. The
   * browser owns the drag selection; only a stationary single click dispatches
   * the source caret. Listeners live on window for the duration of the gesture
   * and are removed on release, leave/blur, Escape and widget destruction.
   */
  private press(event: MouseEvent, sourceFrom: number, view: EditorView) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || view.compositionStarted) return
    this.cleanup?.()
    let moved = false
    let closed = false
    const startX = event.clientX, startY = event.clientY
    const cleanup = () => {
      window.removeEventListener('mousemove', move, true)
      window.removeEventListener('mouseup', release, true)
      window.removeEventListener('blur', cancel, true)
      document.removeEventListener('keydown', key, true)
      this.cleanup = null
    }
    const finish = (commit: boolean) => {
      if (closed) return
      closed = true
      cleanup()
      if (!commit || moved || view.compositionStarted) return
      // A single click, not a double/triple click, opens the source cell.
      if (event.detail !== 1) return
      window.getSelection()?.removeAllRanges()
      view.dispatch({ selection: { anchor: sourceFrom }, scrollIntoView: true })
      view.focus()
      view.requestMeasure()
    }
    const move = (next: MouseEvent) => {
      if (Math.abs(next.clientX - startX) > 3 || Math.abs(next.clientY - startY) > 3) moved = true
    }
    const release = () => finish(true)
    const cancel = () => finish(false)
    const key = (next: KeyboardEvent) => { if (next.key === 'Escape') finish(false) }
    this.cleanup = cleanup
    window.addEventListener('mousemove', move, true)
    window.addEventListener('mouseup', release, true)
    window.addEventListener('blur', cancel, true)
    document.addEventListener('keydown', key, true)
  }
}
