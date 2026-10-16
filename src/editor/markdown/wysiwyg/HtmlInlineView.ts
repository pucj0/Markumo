import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView } from 'prosemirror-view'
import { sanitizeHtml, mountHtmlImages, type MountedImageHandle } from '../html/SafeHtmlRenderer'
import type { MarkdownResources } from '../images'

export class HtmlInlineView implements NodeView {
  readonly dom = document.createElement('span')
  private contentEl = document.createElement('span')
  private popover?: HTMLElement
  private mountedImages?: MountedImageHandle

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private resources?: MarkdownResources
  ) {
    this.dom.className = 'md-html-inline-view'
    this.contentEl.className = 'md-html-inline-content'
    this.dom.append(this.contentEl)

    this.dom.onclick = (e) => {
      // 允许点击打开微型属性编辑气泡
      e.stopPropagation()
      this.openEditPopover()
    }

    this.render()
  }

  private render() {
    this.mountedImages?.destroy()
    this.mountedImages = undefined

    const raw = String(this.node.attrs.source || '')
    const cleanHtml = sanitizeHtml(raw)
    this.contentEl.innerHTML = cleanHtml

    this.mountedImages = mountHtmlImages(this.contentEl, this.resources, () => {
      this.openEditPopover()
    })
  }

  private openEditPopover() {
    if (this.popover) {
      this.closeEditPopover()
      return
    }

    const popover = document.createElement('div')
    popover.className = 'md-html-inline-popover'

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'md-html-inline-input'
    input.value = String(this.node.attrs.source || '')
    input.spellcheck = false

    const save = () => {
      const nextSource = input.value.trim()
      this.closeEditPopover()
      const pos = this.getPos()
      if (pos !== undefined && nextSource && nextSource !== this.node.attrs.source) {
        this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          source: nextSource,
        }))
      }
    }

    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        save()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.closeEditPopover()
      }
    }

    const doneBtn = document.createElement('button')
    doneBtn.type = 'button'
    doneBtn.className = 'md-html-popover-done'
    doneBtn.textContent = '确认'
    doneBtn.onclick = save

    popover.append(input, doneBtn)
    document.body.append(popover)
    this.popover = popover

    const rect = this.dom.getBoundingClientRect()
    popover.style.left = `${Math.max(10, rect.left)}px`
    popover.style.top = `${rect.bottom + 4}px`

    input.focus()
    input.select()

    const onOutside = (e: MouseEvent) => {
      if (!popover.contains(e.target as globalThis.Node) && !this.dom.contains(e.target as globalThis.Node)) {
        this.closeEditPopover()
      }
    }
    setTimeout(() => {
      window.addEventListener('mousedown', onOutside, { once: true })
    }, 0)
  }

  private closeEditPopover() {
    if (this.popover) {
      this.popover.remove()
      this.popover = undefined
    }
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  stopEvent(event: Event) {
    if (this.popover?.contains(event.target as globalThis.Node)) return true
    return false
  }

  ignoreMutation() {
    return true
  }

  destroy() {
    this.closeEditPopover()
    this.mountedImages?.destroy()
    this.dom.remove()
  }
}
