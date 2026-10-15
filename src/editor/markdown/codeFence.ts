import { WidgetType, type EditorView } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { MarkdownNode } from './tableModel'
import { textClipboard } from '../../features/shell/clipboard'

export function fenceModel(state: EditorState, node: MarkdownNode) {
  const marks = node.getChildren('CodeMark'), info = node.getChild('CodeInfo')
  const line = state.doc.lineAt(node.from)
  const closing = marks.length > 1 ? state.doc.lineAt(marks[marks.length - 1].from) : null
  const from = Math.min(node.to, line.to + 1), to = closing ? Math.max(from, closing.from - 1) : node.to
  return { language: info ? state.sliceDoc(info.from,info.to).trim() : 'text', from, to }
}
const controls = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()
export class CodeFenceToolbar extends WidgetType {
  constructor(readonly language: string,readonly showLabel=true) { super() }
  eq(other: CodeFenceToolbar) { return this.language === other.language && this.showLabel===other.showLabel }
  toDOM(view: EditorView) {
    const host = document.createElement('span'); host.className = 'cm-md-fence-tools'
    const label = document.createElement('span'); label.textContent = this.showLabel?this.language:''; label.className = 'cm-md-fence-language'
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '复制代码'; button.setAttribute('aria-label','复制代码')
    host.onmousedown = event => event.preventDefault()
    button.onclick = async () => {
      if (view.compositionStarted) return
      let node = syntaxTree(view.state).resolveInner(view.posAtDOM(host), -1)
      while (node.parent && node.name !== 'FencedCode') node = node.parent
      if (node.name !== 'FencedCode') return
      const model = fenceModel(view.state,node), code = view.state.sliceDoc(model.from,model.to)
      try { await textClipboard.writeText(code); if (!host.isConnected) return; button.textContent = '已复制' }
      catch { if (!host.isConnected) return; button.textContent = '复制失败，请选中后复制' }
      if (controls.has(host)) clearTimeout(controls.get(host))
      controls.set(host,setTimeout(()=>{button.textContent='复制代码';controls.delete(host)},1800))
    }
    host.append(label,button); return host
  }
  destroy(dom: HTMLElement) { if (controls.has(dom)) clearTimeout(controls.get(dom)); controls.delete(dom) }
  ignoreEvent() { return true }
}
