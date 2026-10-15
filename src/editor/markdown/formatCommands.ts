import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import { isolateHistory } from '@codemirror/commands'

export const markdownFormats = [
  ['heading-1', '一级标题'], ['heading-2', '二级标题'], ['heading-3', '三级标题'], ['heading-4', '四级标题'], ['heading-5', '五级标题'], ['heading-6', '六级标题'],
  ['bold', '加粗'], ['italic', '斜体'], ['strike', '删除线'], ['inline-code', '行内代码'], ['code-block', '代码块'],
  ['quote', '引用'], ['bullet', '无序列表'], ['ordered', '有序列表'], ['task', '任务列表'], ['link', '链接'], ['image', '图片语法'], ['rule', '分隔线'], ['table','表格'],
] as const
export type MarkdownFormat = typeof markdownFormats[number][0]

export function markdownFormatTransaction(state: EditorState, format: MarkdownFormat): TransactionSpec {
  if (format === 'table') {
    const at = state.doc.lineAt(state.selection.main.to).to
    const prefix = at > 0 ? (state.doc.lineAt(at).text ? '\n\n' : '\n') : ''
    const source = '| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |'
    return { changes:{from:at,insert:prefix + source + '\n\n'},selection:{anchor:at + prefix.length + 2},annotations:isolateHistory.of('full'),userEvent:'input.format.table' }
  }
  const wrappers: Partial<Record<MarkdownFormat, [string, string, string]>> = {
    bold: ['**', '**', '文本'], italic: ['*', '*', '文本'], strike: ['~~', '~~', '文本'],
    'inline-code': ['`', '`', '代码'], link: ['[', '](https://example.com)', '链接文字'], image: ['![', '](图片路径)', '图片描述'],
    'code-block': ['```\n', '\n```', '代码'], rule: ['\n---\n', '', ''],
  }
  const wrapper = wrappers[format]
  let transaction: TransactionSpec
  if (wrapper) {
    transaction = state.changeByRange(range => {
      let [before, after, placeholder] = wrapper
      const selected = state.sliceDoc(range.from, range.to)
      if (format === 'inline-code' || format === 'code-block') {
        let width = format === 'inline-code' ? 1 : 3
        for (const match of selected.matchAll(/`+/g)) width = Math.max(width, match[0].length + 1)
        before = (format === 'code-block' && state.doc.lineAt(range.from).from !== range.from ? '\n' : '') + '`'.repeat(width) + (format === 'code-block' ? '\n' : '')
        after = (format === 'code-block' ? '\n' : '') + '`'.repeat(width) + (format === 'code-block' && state.doc.lineAt(range.to).to !== range.to ? '\n' : '')
      }
      const toggle = ['bold','italic','strike','inline-code'].includes(format) &&
        state.sliceDoc(Math.max(0, range.from - before.length), range.from) === before && state.sliceDoc(range.to, range.to + after.length) === after
      if (toggle) return { changes: [{ from: range.from - before.length, to: range.from }, { from: range.to, to: range.to + after.length }],
        range: EditorSelection.range(range.from - before.length, range.to - before.length) }
      const text = selected || placeholder
      return { changes: { from: range.from, to: range.to, insert: before + text + after }, range: EditorSelection.range(range.from + before.length, range.from + before.length + text.length) }
    })
  } else {
    const lines = new Set<number>()
    for (const range of state.selection.ranges) {
      const first = state.doc.lineAt(range.from).number, last = state.doc.lineAt(range.to > range.from ? range.to - 1 : range.to).number
      for (let number = first; number <= last; number++) lines.add(number)
    }
    let index = 0
    const changes = [...lines].sort((a,b) => a-b).map(number => {
      const line = state.doc.line(number)
      const prefix = format.startsWith('heading-') ? '#'.repeat(Number(format.slice(-1))) + ' ' : format === 'quote' ? '> ' : format === 'bullet' ? '- ' : format === 'ordered' ? `${++index}. ` : '- [ ] '
      const indent = /^[ \t]*/.exec(line.text)![0].length
      const old = /^(?:#{1,6}\s+|>\s+|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/.exec(line.text.slice(indent))?.[0] || ''
      return { from: line.from + indent, to: line.from + indent + old.length, insert: old === prefix ? '' : prefix }
    })
    transaction = { changes, selection: state.selection.map(state.changes(changes)) }
  }
  return { ...transaction, annotations: isolateHistory.of('full'), userEvent: 'input.format' }
}
