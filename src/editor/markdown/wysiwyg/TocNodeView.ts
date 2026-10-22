import type { Node } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { setStaticIcon, textElement } from './safeDom'
import { headingsFor } from './tocIndex'

/** Fixed, audited icon template. Never built from document content. */
const TOC_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="md-toc-icon"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>'

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
  /** Signature of the heading list currently rendered, to skip no-op rebuilds. */
  private rendered = ''

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
    // Fixed icon template, validated; the caption is plain text.
    setStaticIcon(this.titleEl, TOC_ICON)
    this.titleEl.append(textElement('span', undefined, '目录'))

    this.deleteBtn = document.createElement('button')
    this.deleteBtn.type = 'button'
    this.deleteBtn.className = 'md-toc-delete-btn'
    this.deleteBtn.title = '删除目录'
    this.deleteBtn.textContent = '✕'
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

  private extractHeadings(): readonly HeadingItem[] {
    // Shared, immutable-document cache: several TOC nodes and repeated selection
    // changes reuse one scan instead of walking the document each time.
    return headingsFor(this.view.state.doc, this.view.state.schema.nodes.heading)
  }

  refreshHeadings() {
    if (this.disposed) return
    const headings = this.extractHeadings()
    // Selection changes fire on every keystroke; rebuilding identical DOM each
    // time is pure waste. The rendered signature decides whether a rebuild is
    // actually needed.
    const signature = headings.map(heading => `${heading.level}:${heading.pos}:${heading.text}`).join('\u0000')
    if (signature === this.rendered && this.listEl.childElementCount > 0) return
    this.rendered = signature
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
