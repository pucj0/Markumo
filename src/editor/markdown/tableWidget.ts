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
  constructor(readonly model: TableBlockModel) { super() }
  eq(other: TableWidget) { return this.model.from === other.model.from && this.model.source === other.model.source }
  get estimatedHeight() { return 16 + this.model.rows.length * 34 }
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
    this.model.rows.forEach((sourceRow, rowIndex) => {
      const tr = document.createElement('tr'); table.append(tr)
      sourceRow.cells.forEach((cell, columnIndex) => {
        const td = document.createElement(rowIndex === 0 ? 'th' : 'td'); td.style.textAlign = this.model.align[columnIndex]; td.dataset.sourceFrom = String(cell.from)
        inlineDOM(cell, td); if (!cell.text) td.append(document.createTextNode('\u00a0'))
        td.onmouseenter = () => { row = rowIndex; column = columnIndex }
        td.onmousedown = event => {
          if (event.button !== 0 || event.ctrlKey || event.metaKey || view.compositionStarted) return
          event.preventDefault()
          view.dispatch({ selection: { anchor: cell.from }, scrollIntoView: true }); view.focus(); view.requestMeasure()
        }
        tr.append(td)
      })
    })
    return wrapper
  }
  ignoreEvent() { return true }
}
