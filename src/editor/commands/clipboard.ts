import { EditorView } from '@codemirror/view'
import { isolateHistory, selectAll } from '@codemirror/commands'
import type { TextClipboard } from '../../features/shell/clipboard'
export type ClipboardOperation = 'copy' | 'cut' | 'paste' | 'select-all'
export async function editorClipboard(view: EditorView, operation: ClipboardOperation, clipboard: TextClipboard) {
  if (view.compositionStarted) throw new Error('请完成输入法输入后再操作剪贴板。')
  if (operation === 'select-all') { selectAll(view); view.focus(); return }
  const state = view.state, selection = state.selection, doc = state.doc, focused = document.activeElement
  if (operation !== 'copy' && state.readOnly) throw new Error('当前查看内容是只读的。')
  if (operation !== 'paste' && selection.ranges.every(range => range.empty)) return
  const selected = selection.ranges.map(range => state.sliceDoc(range.from,range.to)).join('\n')
  let pasted = ''
  if (operation === 'paste') pasted = await clipboard.readText()
  else await clipboard.writeText(selected)
  if (operation === 'copy') return
  if (!view.dom.isConnected || document.activeElement !== focused || view.compositionStarted || view.state.readOnly || view.state.doc !== doc || !view.state.selection.eq(selection))
    throw new Error('读取剪贴板期间文档或选区已变化，已取消修改。')
  if (pasted.length > 16 * 1024 * 1024) throw new Error('粘贴内容超过16Mi字符，已取消。')
  view.dispatch({...view.state.replaceSelection(operation === 'cut' ? '' : pasted),annotations:isolateHistory.of('full'),userEvent:operation === 'cut' ? 'delete.cut' : 'input.paste'})
  view.focus()
}
export async function inputClipboard(input: HTMLInputElement | HTMLTextAreaElement, operation: ClipboardOperation, clipboard: TextClipboard) {
  const from = input.selectionStart, to = input.selectionEnd, value = input.value, focused = document.activeElement
  if (from === null || to === null) throw new Error('当前输入框不支持此选区操作。')
  if (operation === 'select-all') { input.select(); return }
  if (operation !== 'copy' && (input.readOnly || input.disabled)) throw new Error('当前输入框是只读的。')
  if (operation !== 'paste' && from === to) return
  const text = operation === 'paste' ? await clipboard.readText() : ''
  if (operation !== 'paste') await clipboard.writeText(value.slice(from,to))
  if (operation === 'copy') return
  if (!input.isConnected || document.activeElement !== focused || input.disabled || input.readOnly || input.value !== value || input.selectionStart !== from || input.selectionEnd !== to) throw new Error('输入内容或选区已变化，已取消修改。')
  input.setRangeText(text,from,to,'end'); input.dispatchEvent(new Event('input',{bubbles:true})); input.focus()
}
