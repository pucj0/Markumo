import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { mountMarkdownImage, type MarkdownResources } from '../images'

/**
 * Typora-style image node view.
 *
 * Idle state is exactly the picture — no card, no toolbar, no reserved height.
 * Clicking an image reveals its own Markdown source *inline in the text flow*
 * (`![alt](path)`), with the picture still visible next to it, and a small size
 * badge on the picture's top-right corner that opens the width control.
 *
 * The source is part of the paragraph, so selecting never pushes the document
 * around: a standalone image keeps its height (the picture dominates the line)
 * and an inline image keeps its line. Secondary actions (alignment, preview,
 * properties, delete) live in the editor context menu only.
 */


export class LiveImageView implements NodeView {
  readonly dom = document.createElement('span')
  private media = document.createElement('span')
  private source = document.createElement('span')
  private altInput = document.createElement('input')
  private srcInput = document.createElement('input')
  private browseButton = document.createElement('button')
  private mounted?: ReturnType<typeof mountMarkdownImage>
  private disposed = false
  private selected = false
  private composing = false
  private observer?: ResizeObserver
  private resourceIdentity: string
  private commitTimers: Partial<Record<'alt' | 'src' | 'title', ReturnType<typeof setTimeout>>> = {}
  /** Path last previewed while typing, before it is committed. */
  private previewSrc: string | null = null
  /** True only for a real click: keyboard selection must keep the editor caret. */
  private focusSourceOnSelect = false

  private get pane() {
    return this.view.dom.closest<HTMLElement>('.markdown-live')!
  }

  constructor(
    private node: PMNode,
    private view: EditorView,
    readonly getPos: () => number | undefined,
    private resources: MarkdownResources,
    private onPreviewRequest?: (image: HTMLImageElement, current: () => boolean) => void,
    private onBrowseRequest?: (commit: (src: string | null) => void) => void,
  ) {
    this.resourceIdentity = resources.identity()
    this.dom.className = 'md-image-preview md-live-image'
    this.dom.contentEditable = 'false'
    this.dom.title = '单击编辑图片，双击预览，右键更多操作'

    this.buildSource()
    this.media.className = 'md-image-media'
    this.dom.append(this.source, this.media)

    this.dom.onmousedown = event => {
      if (event.button !== 0) return
      const target = event.target as Element
      if (target.closest('[data-image-source]')) return
      event.preventDefault()
      this.selectImage()
    }
    this.dom.onclick = event => {
      const target = event.target as Element
      if (target.closest('[data-image-source], [data-image-width], [data-image-width-popover]')) return
      event.preventDefault()
      event.stopPropagation()
      this.selectImage()
    }
    this.dom.ondblclick = event => {
      if ((event.target as Element).closest('[data-image-source]')) return
      event.preventDefault()
      event.stopPropagation()
      this.openPreview()
    }
    this.dom.onkeydown = event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      this.dismiss()
    }

    this.loadImage()
    queueMicrotask(() => { if (!this.disposed) this.refreshLayout() })
  }

  // --- source strip -------------------------------------------------------

  private buildSource() {
    this.source.className = 'md-image-source'
    this.source.setAttribute('data-image-source', '')
    this.source.hidden = true
    this.source.contentEditable = 'false'

    const token = (text: string) => {
      const span = document.createElement('span')
      span.className = 'md-image-source-token'
      span.textContent = text
      span.setAttribute('aria-hidden', 'true')
      return span
    }

    this.altInput.type = 'text'
    this.altInput.className = 'md-image-alt'
    this.altInput.setAttribute('data-image-alt', '')
    this.altInput.setAttribute('aria-label', '图片替代文字')
    this.altInput.placeholder = '替代文字'
    this.altInput.spellcheck = false

    this.srcInput.type = 'text'
    this.srcInput.className = 'md-image-src'
    this.srcInput.setAttribute('data-image-src', '')
    this.srcInput.setAttribute('aria-label', '图片路径')
    this.srcInput.placeholder = '输入图片路径'
    this.srcInput.spellcheck = false

    this.browseButton.type = 'button'
    this.browseButton.className = 'md-image-browse'
    this.browseButton.setAttribute('data-image-browse', '')
    this.browseButton.setAttribute('aria-label', '选择图片文件')
    this.browseButton.title = '选择图片文件'
    this.browseButton.textContent = '📁'
    this.browseButton.addEventListener('mousedown', event => event.preventDefault())
    this.browseButton.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      this.onBrowseRequest?.(src => {
        if (src && src !== this.node.attrs.src) this.commitValues({ src })
      })
    })

    for (const input of [this.altInput, this.srcInput]) {
      input.addEventListener('input', () => {
        this.sizeField(input)
        if (this.composing) return
        const field = input === this.altInput ? 'alt' : 'src'
        this.previewValues(field === 'alt' ? { alt: input.value } : { src: input.value })
        this.scheduleCommit(field)
      })
      input.addEventListener('compositionstart', () => { this.composing = true })
      input.addEventListener('compositionend', () => {
        this.composing = false
        const field = input === this.altInput ? 'alt' : 'src'
        this.previewValues(field === 'alt' ? { alt: input.value } : { src: input.value })
        this.commitValues(field === 'alt' ? { alt: input.value } : { src: input.value })
      })
      input.addEventListener('change', () => {
        const field = input === this.altInput ? 'alt' : 'src'
        this.commitValues(field === 'alt' ? { alt: input.value } : { src: input.value })
      })
      input.addEventListener('mousedown', event => event.stopPropagation())
      input.addEventListener('click', event => event.stopPropagation())
    }

    this.source.append(token('!['), this.altInput, token(']('), this.srcInput, this.browseButton, token(')'))
  }

  /** Keeps the inline source as narrow as its text, like Typora. */
  private sizeField(input: HTMLInputElement) {
    input.style.width = Math.max(4, input.value.length + 1) + 'ch'
  }


  // --- editing ------------------------------------------------------------

  private scheduleCommit(field: 'alt' | 'src') {
    clearTimeout(this.commitTimers[field])
    this.commitTimers[field] = setTimeout(() => {
      const value = field === 'alt' ? this.altInput.value : this.srcInput.value
      this.commitValues(field === 'alt' ? { alt: value } : { src: value })
    }, 250)
  }

  /** Immediate visual feedback while typing, without a document edit. */
  private previewValues(values: { alt?: string; src?: string }) {
    if (this.disposed) return
    if (values.src !== undefined && values.src !== this.previewSrc) {
      this.previewSrc = values.src
      this.mounted?.destroy()
      this.mounted = mountMarkdownImage(this.media, values.src, values.alt ?? String(this.node.attrs.alt ?? ''), this.resources,
        () => this.selectImage(), () => {
          this.dom.classList.toggle('is-broken-image', this.media.classList.contains('is-broken-image'))
        }, { live: true })
    }
    if (values.alt !== undefined) this.media.title = `${values.alt}\n${values.src ?? this.node.attrs.src ?? ''}`
  }

  /** Writes alt/path as one undoable document edit. */
  private commitValues(values: { alt?: string; src?: string }) {
    const pos = this.getPos()
    if (this.disposed || !this.view.editable || pos === undefined || this.view.state.doc.nodeAt(pos) !== this.node) return
    const next = { ...this.node.attrs, ...values }
    if (next.alt === this.node.attrs.alt && next.src === this.node.attrs.src) return
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, next)
    // Replacing the selected node invalidates the old NodeSelection; keep it so
    // the source strip stays open while typing.
    this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)).setMeta('isolated', true))
  }

  private selectImage() {
    const pos = this.getPos()
    if (this.disposed || pos === undefined || this.view.state.doc.nodeAt(pos) !== this.node) return
    const selection = this.view.state.selection
    if (!(selection instanceof NodeSelection) || selection.from !== pos) {
      this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)))
    }
    // A real click puts the caret in the source (Typora); the editor keeps focus
    // for any other way of selecting the image.
    this.focusSourceOnSelect = true
    this.selectNode()
  }

  private dismiss() {
    this.deselectNode()
    this.view.focus()
  }

  private openPreview() {
    const image = this.media.querySelector('img'), expected = this.node
    if (!image?.naturalWidth || this.disposed) return
    this.onPreviewRequest?.(image, () => !this.disposed && this.getPos() !== undefined && this.view.state.doc.nodeAt(this.getPos()!) === expected)
  }

  // --- rendering ----------------------------------------------------------

  loadImage() {
    this.mounted?.destroy()
    this.mounted = mountMarkdownImage(this.media, this.node.attrs.src ?? '', this.node.attrs.alt ?? '', this.resources,
      () => this.selectImage(), () => {
        this.dom.classList.toggle('is-broken-image', this.media.classList.contains('is-broken-image'))
      }, { live: true })
  }

  refreshResource() {
    const identity = this.resources.identity()
    if (identity !== this.resourceIdentity) { this.resourceIdentity = identity; this.loadImage() }
  }

  refreshLayout() {
    const pos = this.getPos()
    if (this.disposed || pos === undefined) return
    const parent = this.view.state.doc.resolve(pos).parent
    const standalone = parent.type.name === 'paragraph' && parent.childCount === 1
    this.dom.classList.toggle('md-image-standalone', standalone)
    const width = this.node.attrs.width === 'auto' ? null : this.node.attrs.width, align = this.node.attrs.align
    this.dom.style.width = width
      ? /(?:%|px)$/.test(String(width)) ? width : width + 'px'
      : standalone && align ? 'fit-content' : ''
    this.dom.classList.toggle('md-image-sized', !!width)
    // While editing, source and picture form one row. An inline image must stay
    // inline (never blockified) or it would break the text line it lives in.
    const editing = this.selected
    this.dom.style.display = editing
      ? (standalone ? 'flex' : 'inline-flex')
      : standalone && align ? 'block' : ''
    this.dom.style.alignItems = editing ? 'center' : ''
    this.dom.style.justifyContent = editing ? 'center' : ''
    this.dom.style.gap = editing ? '6px' : ''
    this.dom.style.whiteSpace = editing ? 'nowrap' : ''
    this.media.style.display = editing ? 'inline-flex' : ''
    this.media.style.alignItems = editing ? 'center' : ''
    this.media.style.width = editing ? 'auto' : ''
    this.media.style.lineHeight = editing ? '1' : ''
    // Inline alignment must never split a mixed text paragraph into blocks.
    this.dom.style.margin = standalone && align ? align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : '0 auto 0 0' : ''
    this.dom.style.textAlign = standalone ? align ?? '' : ''
    // The media box must not stretch, or left/right alignment cannot apply.
    if (standalone) this.media.style.maxWidth = '100%'
    this.dom.dataset.imageAlign = standalone ? align ?? '' : ''
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    const reload = node.attrs.src !== this.node.attrs.src || node.attrs.alt !== this.node.attrs.alt
    this.node = node
    if (reload) { this.previewSrc = String(node.attrs.src ?? ''); this.loadImage() }
    if (document.activeElement !== this.altInput) this.altInput.value = String(node.attrs.alt ?? '')
    if (document.activeElement !== this.srcInput) this.srcInput.value = String(node.attrs.src ?? '')
    this.refreshLayout()
    return true
  }

  selectNode() {
    if (this.disposed) return
    const first = !this.selected
    this.selected = true
    this.dom.classList.add('md-image-selected')
    this.altInput.value = String(this.node.attrs.alt ?? '')
    this.srcInput.value = String(this.node.attrs.src ?? '')
    this.sizeField(this.altInput)
    this.sizeField(this.srcInput)
    this.source.hidden = false
    this.refreshLayout()
    if (first) {
      window.addEventListener('resize', this.reposition)
      window.addEventListener('keydown', this.onEscape, true)
      document.addEventListener('focusin', this.reposition)
      this.observer = new ResizeObserver(this.reposition)
      this.observer.observe(this.pane)
      this.observer.observe(this.media)
    }
    this.reposition()
    // Only a click moves the caret into the source; selecting with the arrow
    // keys (or after undo) must leave the editor caret alone.
    if (!this.focusSourceOnSelect) return
    this.focusSourceOnSelect = false
    if (!this.srcInput.value.trim()) {
      this.srcInput.focus()
      this.srcInput.select()
    } else {
      this.altInput.focus()
      const end = this.altInput.value.length
      this.altInput.setSelectionRange(end, end)
    }
  }

  private reposition = () => {}

  /** Escape leaves the editing state from the editor or from the source fields. */
  private onEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || this.disposed || !this.selected) return
    // Never steal Escape from an open dialog (image preview, properties, menus).
    if (document.querySelector('[role="dialog"], .md-context-menu')) return
    event.preventDefault()
    this.dismiss()
  }

  deselectNode() {
    this.selected = false
    this.dom.classList.remove('md-image-selected')
    this.source.hidden = true
    for (const timer of Object.values(this.commitTimers)) clearTimeout(timer)
    window.removeEventListener('resize', this.reposition)
    window.removeEventListener('keydown', this.onEscape, true)
    document.removeEventListener('focusin', this.reposition)
    this.observer?.disconnect()
    this.observer = undefined
  }

  stopEvent(event: Event) {
    // The strip is part of this node view: keys and clicks inside it are ours.
    if (event.target instanceof Element && event.target.closest('[data-image-source]')) return true
    // Right-click must reach the editor so its context menu can open.
    if (event.type === 'contextmenu') return false
    return !(event instanceof KeyboardEvent)
  }

  ignoreMutation() { return true }

  destroy() {
    this.deselectNode()
    this.disposed = true
    this.mounted?.destroy()
    this.dom.onclick = this.dom.ondblclick = this.dom.onmousedown = this.dom.onkeydown = null
  }
}
