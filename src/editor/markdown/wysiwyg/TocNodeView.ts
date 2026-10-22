import type { Node } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'

interface HeadingItem {
  pos: number
  level: number
  text: string
}

export class TocNodeView implements NodeView {
  readonly dom: HTMLElement
  private header: HTMLElement
  private titleEl: HTMLElement
  private deleteBtn: HTMLButtonElement
  private listEl: HTMLElement
  private disposed = false

  constructor(
    private node: Node,
    private view: EditorView,
    private getPos: () => number | undefined,
    private readOnly: () => boolean = () => false
  ) {
    this.dom = document.createElement('nav')
    this.dom.className = 'md-toc-block'
    this.dom.setAttribute('data-toc', 'true')
    this.dom.contentEditable = 'false'

    // Header
    this.header = document.createElement('div')
    this.header.className = 'md-toc-header'

    this.titleEl = document.createElement('span')
    this.titleEl.className = 'md-toc-title'
    this.titleEl.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="md-toc-icon"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg><span>目录</span>`

    this.deleteBtn = document.createElement('button')
    this.deleteBtn.type = 'button'
    this.deleteBtn.className = 'md-toc-delete-btn'
    this.deleteBtn.title = '删除目录'
    this.deleteBtn.innerHTML = '✕'
    this.deleteBtn.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (this.readOnly()) return
      const pos = this.getPos()
      if (pos !== undefined) {
        this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize))
        this.view.focus()
      }
    }

    this.header.append(this.titleEl, this.deleteBtn)

    // Items list
    this.listEl = document.createElement('div')
    this.listEl.className = 'md-toc-list'

    this.dom.append(this.header, this.listEl)
    this.refreshHeadings()
  }

  private extractHeadings(): HeadingItem[] {
    const headings: HeadingItem[] = []
    const schema = this.view.state.schema
    this.view.state.doc.descendants((node, pos) => {
      if (node.type === schema.nodes.heading) {
        headings.push({
          pos,
          level: node.attrs.level || 1,
          text: node.textContent.trim(),
        })
      }
    })
    return headings
  }

  refreshHeadings() {
    if (this.disposed) return
    const headings = this.extractHeadings()
    this.listEl.replaceChildren()

    if (!headings.length) {
      const empty = document.createElement('p')
      empty.className = 'md-toc-empty'
      empty.textContent = '（文档中暂无标题）'
      this.listEl.append(empty)
      return
    }

    for (const h of headings) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'md-toc-item'
      item.style.paddingLeft = `${Math.max(0, (h.level - 1) * 16 + 8)}px`
      item.title = `跳转到：${h.text || '无标题'}`

      const text = document.createElement('span')
      text.className = 'md-toc-text'
      text.textContent = h.text || '（空标题）'

      item.append(text)
      item.onclick = (e) => {
        e.preventDefault()
        e.stopPropagation()
        const targetPos = Math.min(h.pos + 1, this.view.state.doc.content.size)
        const tr = this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, targetPos)).scrollIntoView()
        this.view.dispatch(tr)
        this.view.focus()
      }
      this.listEl.append(item)
    }
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.refreshHeadings()
    return true
  }

  stopEvent() {
    return true
  }

  ignoreMutation() {
    return true
  }

  destroy() {
    this.disposed = true
  }
}
