import type { EditorState, TransactionSpec } from '@codemirror/state'
import type { syntaxTree } from '@codemirror/language'
import { isolateHistory } from '@codemirror/commands'
export type MarkdownNode = ReturnType<typeof syntaxTree>['topNode']

export interface InlineNode { name: string; from: number; to: number; children: InlineNode[] }
export interface TableCell { from: number; to: number; text: string; inline?: InlineNode[] }
export interface TableRow { from: number; to: number; cells: TableCell[] }
export interface TableBlockModel {
  from: number; to: number; source: string; rows: TableRow[]
  align: ('left' | 'center' | 'right')[]
}
/** GFM pipes split cells unless escaped (including pipes inside code spans). */
export function tableRow(text: string, from: number): TableRow {
  const boundaries: number[] = [-1]
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '|') continue
    let slashes = 0
    for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) slashes++
    if (slashes % 2 === 0) boundaries.push(i)
  }
  boundaries.push(text.length)
  const cells: TableCell[] = []
  for (let i = 1; i < boundaries.length; i++) {
    const start = boundaries[i - 1] + 1, end = boundaries[i]
    if ((i === 1 || i === boundaries.length - 1) && !text.slice(start, end).trim() && boundaries.length > 2) continue
    const raw = text.slice(start, end), leading = raw.length - raw.trimStart().length
    const trimmed = raw.trim()
    cells.push({ from: from + start + leading, to: from + start + leading + trimmed.length, text: trimmed })
  }
  return { from, to: from + text.length, cells }
}
/** AST recognition is mandatory; this function never guesses tables in prose/code. */
export function tableModel(state: EditorState, node: MarkdownNode): TableBlockModel | null {
  if (node.name !== 'Table' || node.parent?.name !== 'Document') return null
  const first = state.doc.lineAt(node.from), last = state.doc.lineAt(node.to)
  if (last.number - first.number > 500 || node.to - node.from > 64 * 1024) return null
  const rows: TableRow[] = []
  for (let n = first.number; n <= last.number; n++) { const line = state.doc.line(n); rows.push(tableRow(line.text, line.from)) }
  if (rows.length < 2 || !rows[0].cells.length || rows[0].cells.length > 64 || rows[1].cells.length !== rows[0].cells.length) return null
  const delimiter = rows[1].cells
  if (delimiter.some(cell => !/^:?-+:?$/.test(cell.text))) return null
  const align = delimiter.map(cell => cell.text.startsWith(':') && cell.text.endsWith(':') ? 'center' as const : cell.text.endsWith(':') ? 'right' as const : 'left' as const)
  const data = [rows[0], ...rows.slice(2)]
  // Missing GFM cells are valid. Map an empty cell to the row end for source editing.
  for (const row of data) {
    row.cells = row.cells.slice(0, align.length)
    while (row.cells.length < align.length) row.cells.push({ from: row.to, to: row.to, text: '' })
  }
  const astRows = [node.getChild('TableHeader'), ...node.getChildren('TableRow')]
  const inline = (node: MarkdownNode, start: number): InlineNode => {
    const children: InlineNode[] = []
    for (let child = node.firstChild; child; child = child.nextSibling) children.push(inline(child, start))
    return { name: node.name, from: node.from - start, to: node.to - start, children }
  }
  data.forEach((row, index) => {
    const cells = astRows[index]?.getChildren('TableCell') || []
    for (const cell of row.cells) {
      const ast = cells.find(node => node.from === cell.from && node.to === cell.to)
      if (ast) cell.inline = inline(ast, cell.from).children
    }
  })
  return { from: first.from, to: last.to, source: state.sliceDoc(first.from, last.to), rows: data, align }
}

export type TableOperation = 'row-add' | 'row-delete' | 'column-add' | 'column-delete'
export function editTable(model: TableBlockModel, operation: TableOperation, row: number, column: number): TransactionSpec | null {
  if (row < 0 || row >= model.rows.length || column < 0 || column >= model.align.length) return null
  const rows = model.rows.map(row => row.cells.map(cell => cell.text)), align = [...model.align]
  if (operation === 'row-add') rows.splice(row + 1, 0, align.map(() => ''))
  if (operation === 'row-delete') { if (!row) return null; rows.splice(row, 1) }
  if (operation === 'column-add') { rows.forEach(cells => cells.splice(column + 1, 0, '')); align.splice(column + 1, 0, 'left') }
  if (operation === 'column-delete') { if (align.length <= 1) return null; rows.forEach(cells => cells.splice(column, 1)); align.splice(column, 1) }
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`
  const delimiter = align.map(value => value === 'center' ? ':---:' : value === 'right' ? '---:' : ':---')
  const insert = [line(rows[0]), line(delimiter), ...rows.slice(1).map(line)].join('\n')
  return { changes: { from: model.from, to: model.to, insert }, selection: { anchor: model.from }, annotations: isolateHistory.of('full'), userEvent: 'input.table' }
}
export function editTableCell(model: TableBlockModel, row: number, column: number, text: string): TransactionSpec | null {
  const cell = model.rows[row]?.cells[column]
  if (!cell || /[\r\n]/.test(text) || cell.from === model.rows[row].to) return null
  // Unescaped pipes would change the column count; literal input is escaped.
  const insert = text.replace(/\|/g, (_pipe, offset: number) => {
    let slashes = 0
    for (let index = offset - 1; index >= 0 && text[index] === '\\'; index--) slashes++
    return slashes % 2 ? '|' : '\\|'
  })
  return { changes: { from: cell.from, to: cell.to, insert }, selection: { anchor: cell.from + insert.length }, annotations: isolateHistory.of('full'), userEvent: 'input.table' }
}
