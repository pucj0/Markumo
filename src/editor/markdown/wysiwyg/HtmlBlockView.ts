import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView } from 'prosemirror-view'
import { sanitizeHtml, mountHtmlImages, type MountedImageHandle } from '../html/SafeHtmlRenderer'
import type { MarkdownResources } from '../images'

export class HtmlBlockView implements NodeView {
  readonly dom = document.createElement('div')
  private previewEl = document.createElement('div')
  private editorEl = document.createElement('div')
  private textarea = document.createElement('textarea')
  private editBtn = document.createElement('button')
  private doneBtn = document.createElement('button')
  private cancelBtn = document.createElement('button')
  private errorTip = document.createElement('div')
  private isEditing = false
  private mountedImages?: MountedImageHandle

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private resources?: MarkdownResources,
    private history?: (forward: boolean) => void
  ) {
    this.dom.className = 'md-html-block-view'
    this.dom.contentEditable = 'false'

    // 1. 渲染预览容器
    this.previewEl.className = 'md-html-preview'

    // 2. 悬浮“编辑 HTML”小按钮
    this.editBtn.type = 'button'
    this.editBtn.className = 'md-html-edit-trigger'
    this.editBtn.title = '编辑 HTML 源码'
    this.editBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
      <span>编辑 HTML</span>
    `
    this.editBtn.onclick = (e) => {
      e.stopPropagation()
      this.startEditing()
    }

    // 3. 源码编辑容器
    this.editorEl.className = 'md-html-source-editor'
    this.editorEl.hidden = true

    const toolbar = document.createElement('div')
    toolbar.className = 'md-html-editor-toolbar'

    const titleSpan = document.createElement('span')
    titleSpan.className = 'md-html-toolbar-title'
    titleSpan.textContent = 'HTML 源码编辑'

    const btnGroup = document.createElement('div')
    btnGroup.className = 'md-html-toolbar-actions'

    this.doneBtn.type = 'button'
    this.doneBtn.className = 'md-html-done-btn'
    this.doneBtn.textContent = '完成 (Ctrl+Enter)'
    this.doneBtn.onclick = (e) => {
      e.stopPropagation()
      this.saveSource()
    }

    this.cancelBtn.type = 'button'
    this.cancelBtn.className = 'md-html-cancel-btn'
    this.cancelBtn.textContent = '取消 (Esc)'
    this.cancelBtn.onclick = (e) => {
      e.stopPropagation()
      this.cancelEditing()
    }

    btnGroup.append(this.cancelBtn, this.doneBtn)
    toolbar.append(titleSpan, btnGroup)

    this.textarea.className = 'md-html-textarea'
    this.textarea.spellcheck = false
    this.textarea.setAttribute('aria-label', 'HTML 源码编辑')
    this.textarea.onkeydown = (e) => {
      if (e.isComposing) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.cancelEditing()
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        e.stopPropagation()
        this.saveSource()
      } else if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
        if (this.history) {
          e.preventDefault()
          e.stopPropagation()
          this.history(e.key.toLowerCase() === 'y' || e.shiftKey)
        }
      }
    }

    this.errorTip.className = 'md-html-error-tip'
    this.errorTip.hidden = true

    this.editorEl.append(toolbar, this.textarea, this.errorTip)

    this.dom.append(this.previewEl, this.editBtn, this.editorEl)

    // 点击预览区域可直接进入源码编辑
    this.previewEl.onclick = (e) => {
      // 若点击的是交互控件如 input 复选框或详情展开，不强制进入编辑
      const target = e.target as HTMLElement
      if (target.closest('input, button, summary, a')) return
      this.startEditing()
    }

    this.renderPreview()
  }

  private renderPreview() {
    this.mountedImages?.destroy()
    this.mountedImages = undefined

    const raw = String(this.node.attrs.source || '')
    const cleanHtml = sanitizeHtml(raw)
    this.previewEl.innerHTML = cleanHtml

    // 挂载可能包含的图片资源
    this.mountedImages = mountHtmlImages(this.previewEl, this.resources, () => {
      this.startEditing()
    })
  }

  startEditing() {
    if (this.isEditing) return
    this.isEditing = true
    this.previewEl.hidden = true
    this.editBtn.hidden = true
    this.editorEl.hidden = false
    this.errorTip.hidden = true

    this.textarea.value = String(this.node.attrs.source || '')
    this.autoResizeTextarea()
    setTimeout(() => {
      this.textarea.focus()
    }, 0)
  }

  private autoResizeTextarea() {
    this.textarea.style.height = 'auto'
    this.textarea.style.height = `${Math.max(80, Math.min(480, this.textarea.scrollHeight + 4))}px`
  }

  saveSource() {
    if (!this.isEditing) return
    const pos = this.getPos()
    if (pos === undefined || this.view.state.doc.nodeAt(pos) !== this.node) {
      this.cancelEditing()
      return
    }

    const nextSource = this.textarea.value
    this.isEditing = false
    this.editorEl.hidden = true
    this.previewEl.hidden = false
    this.editBtn.hidden = false

    if (nextSource !== this.node.attrs.source) {
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.node.attrs,
        source: nextSource,
      })
      this.view.dispatch(tr)
    }

    this.renderPreview()
    this.view.focus()
  }

  cancelEditing() {
    this.isEditing = false
    this.editorEl.hidden = true
    this.previewEl.hidden = false
    this.editBtn.hidden = false
    this.errorTip.hidden = true
    this.view.focus()
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    if (!this.isEditing) {
      this.renderPreview()
    }
    return true
  }

  stopEvent(event: Event) {
    if (this.isEditing && this.editorEl.contains(event.target as globalThis.Node)) {
      return true
    }
    return false
  }

  ignoreMutation() {
    return true
  }

  destroy() {
    this.mountedImages?.destroy()
    this.dom.remove()
  }
}
