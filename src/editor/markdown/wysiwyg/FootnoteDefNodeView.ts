import type { Node } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'

export class FootnoteDefNodeView implements NodeView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  private badgeWrap: HTMLElement
  private badgeBtn: HTMLButtonElement

  constructor(
    private node: Node,
    private view: EditorView,
    _getPos?: () => number | undefined,
    _readOnly?: () => boolean
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'md-footnote-def-node'
    this.dom.setAttribute('data-footnote-label', node.attrs.label || '1')

    this.badgeWrap = document.createElement('div')
    this.badgeWrap.className = 'md-footnote-def-badge-wrap'
    this.badgeWrap.contentEditable = 'false'

    this.badgeBtn = document.createElement('button')
    this.badgeBtn.type = 'button'
    this.badgeBtn.className = 'md-footnote-def-badge'
    this.badgeBtn.title = `脚注 [^${node.attrs.label || '1'}]（点击跳转至正文引用）`
    this.badgeBtn.innerHTML = `<span>[^${node.attrs.label || '1'}]</span><span class="md-footnote-back-icon" aria-hidden="true"> ↩</span>`

    this.badgeBtn.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.jumpToRef()
    }

    this.badgeWrap.append(this.badgeBtn)

    // ProseMirror editable content container
    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'md-footnote-def-content'

    this.dom.append(this.badgeWrap, this.contentDOM)
  }

  private jumpToRef() {
    const targetLabel = this.node.attrs.label
    let foundPos: number | null = null
    const schema = this.view.state.schema

    this.view.state.doc.descendants((node, pos) => {
      if (foundPos !== null) return false
      if (node.type === schema.nodes.footnote_reference && node.attrs.label === targetLabel) {
        foundPos = pos
        return false
      }
    })

    if (foundPos !== null) {
      const tr = this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, foundPos + 1)).scrollIntoView()
      this.view.dispatch(tr)
      this.view.focus()
    }
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.dom.setAttribute('data-footnote-label', node.attrs.label || '1')
    this.badgeBtn.innerHTML = `<span>[^${node.attrs.label || '1'}]</span><span class="md-footnote-back-icon" aria-hidden="true"> ↩</span>`
    return true
  }

  stopEvent(event: Event) {
    const target = event.target as globalThis.Node | null
    if (this.contentDOM.contains(target)) {
      return false
    }
    return true
  }

  ignoreMutation(mutation: any) {
    if (this.contentDOM && this.contentDOM.contains(mutation.target as globalThis.Node)) {
      return false
    }
    return true
  }

  destroy() {}
}
