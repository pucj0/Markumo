import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { mountMarkdownImage, type MarkdownResources } from '../images'
import { positionImageOverlay } from './imageOverlay'

export class LiveImageView implements NodeView {
  readonly dom = document.createElement('span')
  private media = document.createElement('span')
  private toolbar = document.createElement('div')
  private mounted?: ReturnType<typeof mountMarkdownImage>
  private disposed = false
  private selected = false
  private frame = 0
  private observer?: ResizeObserver
  private resourceIdentity: string
  private get pane() { return this.view.dom.closest<HTMLElement>('.markdown-live')! }

  constructor(
    private node: PMNode,
    private view: EditorView,
    readonly getPos: () => number | undefined,
    private resources: MarkdownResources,
    private onEditRequest: (imgEl: HTMLElement, node: PMNode, pos: number) => void,
    private onPropertiesRequest?: (imgEl: HTMLElement, node: PMNode, pos: number) => void,
    private onPreviewRequest?: (image: HTMLImageElement, current: () => boolean) => void
  ) {
    this.resourceIdentity = resources.identity()
    this.dom.className = 'md-image-preview md-live-image'
    this.dom.contentEditable = 'false'
    this.dom.title = '单击选中图片，双击放大预览，右键编辑属性'
    this.toolbar.className = 'md-image-toolbar'
    this.toolbar.setAttribute('role', 'toolbar')
    this.toolbar.setAttribute('aria-label', '图片操作')
    this.toolbar.contentEditable = 'false'
    this.toolbar.hidden = true
    this.toolbar.onmousedown = event => event.preventDefault()
    this.buildToolbar()
    this.dom.append(this.media, this.toolbar)
    this.dom.onmousedown = event => {
      if (event.button !== 0 || (event.target as Element).closest('button') || this.toolbar.contains(event.target as globalThis.Node)) return
      event.preventDefault(); this.selectImage()
    }
    this.dom.onclick = event => {
      if ((event.target as Element).closest('button') || this.toolbar.contains(event.target as globalThis.Node)) return
      event.preventDefault(); event.stopPropagation(); this.selectImage()
    }
    this.dom.ondblclick = event => {
      if ((event.target as Element).closest('button')) return
      event.preventDefault(); event.stopPropagation(); this.openPreview()
    }
    this.dom.oncontextmenu = event => {
      event.preventDefault(); event.stopPropagation(); this.selectImage(); this.properties()
    }
    this.loadImage()
    queueMicrotask(() => { if (!this.disposed) this.refreshLayout() })
  }

  private selectImage() {
    const pos = this.getPos()
    if (this.disposed || pos === undefined || this.view.state.doc.nodeAt(pos) !== this.node) return
    const selection = this.view.state.selection
    if (!(selection instanceof NodeSelection) || selection.from !== pos) {
      this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)))
    }
    this.view.focus(); this.selectNode()
  }

  private properties() {
    const pos = this.getPos()
    if (!this.disposed && pos !== undefined && this.view.state.doc.nodeAt(pos) === this.node) {
      (this.onPropertiesRequest ?? this.onEditRequest)(this.dom, this.node, pos)
    }
  }

  private buildToolbar() {
    const button = (className: string, label: string, text: string, run: () => void) => {
      const el = document.createElement('button')
      el.type = 'button'; el.className = `md-img-tool-btn ${className}`
      el.title = label; el.setAttribute('aria-label', label); el.textContent = text
      el.onclick = event => { event.preventDefault(); event.stopPropagation(); run() }
      this.toolbar.append(el)
    }
    for (const [align, label, icon] of [['left', '左对齐', '⇤'], ['center', '居中', '⇋'], ['right', '右对齐', '⇥']]) {
      button(`md-img-align-${align}`, label, icon, () => this.applyAttributes(this.node.attrs.width, this.node.attrs.align === align ? null : align))
    }
    for (const width of ['25%', '50%', '75%', '100%', null]) {
      button(`md-img-width-${width?.replace('%', '') ?? 'auto'}`, `宽度 ${width ?? '原图'}`, width ?? '原图', () => this.applyAttributes(width, this.node.attrs.align))
    }
    button('md-img-tool-preview', '放大预览', '放大', () => this.openPreview())
    button('md-img-tool-properties', '图片属性', '属性', () => this.properties())
    // Keep explicit source editing for users who ask for it.
    button('md-img-tool-edit', '图片源码', '</>', () => {
      const pos = this.getPos()
      if (pos !== undefined) this.onEditRequest(this.dom, this.node, pos)
    })
    button('md-img-tool-delete', '删除图片', '删除', () => this.deleteImage())
  }

  private applyAttributes(width: string | null, align: string | null) {
    const pos = this.getPos()
    if (pos === undefined || this.disposed || !this.view.editable || this.node.attrs.width === width && this.node.attrs.align === align) return
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, width, align })
    this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)).setMeta('isolated', true))
    this.view.focus()
  }

  private deleteImage() {
    const pos = this.getPos()
    if (pos === undefined || this.disposed || !this.view.editable) return
    const doc = this.view.state.doc, $pos = doc.resolve(pos)
    const standalone = $pos.parent.type.name === 'paragraph' && $pos.parent.childCount === 1
    const tr = standalone && (doc.childCount > 1 || $pos.depth > 1)
      ? this.view.state.tr.delete($pos.before(), $pos.after())
      : this.view.state.tr.delete(pos, pos + this.node.nodeSize)
    this.view.dispatch(tr.setMeta('isolated', true)); this.view.focus()
  }

  refreshLayout() {
    const pos = this.getPos()
    if (this.disposed || pos === undefined) return
    const parent = this.view.state.doc.resolve(pos).parent
    const standalone = parent.type.name === 'paragraph' && parent.childCount === 1
    this.dom.classList.toggle('md-image-standalone', standalone)
    const width = this.node.attrs.width === 'auto' ? null : this.node.attrs.width, align = this.node.attrs.align
    this.dom.style.width = width ? /(?:%|px)$/.test(String(width)) ? width : `${width}px` : ''
    this.dom.classList.toggle('md-image-sized', !!width)
    // Inline alignment must never split a mixed text paragraph into blocks.
    this.dom.style.display = standalone && align ? 'block' : ''
    this.dom.style.margin = standalone && align ? align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : '0 auto 0 0' : ''
    this.dom.style.textAlign = standalone ? align ?? '' : ''
    this.dom.dataset.imageAlign = standalone ? align ?? '' : ''
    this.schedulePosition()
  }

  private schedulePosition = () => {
    if (!this.selected || this.disposed || this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      if (this.selected && !this.disposed) {
        this.toolbar.hidden = !this.view.hasFocus()
        if (!this.toolbar.hidden) positionImageOverlay(this.toolbar, this.media.querySelector('img') ?? this.media, this.pane)
      }
    })
  }

  private openPreview() {
    const image = this.media.querySelector('img'), expected = this.node
    if (!image?.naturalWidth || this.disposed) return
    this.onPreviewRequest?.(image, () => !this.disposed && this.getPos() !== undefined && this.view.state.doc.nodeAt(this.getPos()!) === expected)
  }

  loadImage() {
    this.mounted?.destroy()
    this.mounted = mountMarkdownImage(this.media, this.node.attrs.src ?? '', this.node.attrs.alt ?? '', this.resources,
      () => this.properties(), () => {
        this.dom.classList.toggle('is-broken-image', this.media.classList.contains('is-broken-image'))
        this.schedulePosition()
      }, { live: true })
  }

  refreshResource() {
    const identity = this.resources.identity()
    if (identity !== this.resourceIdentity) { this.resourceIdentity = identity; this.loadImage() }
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    const reload = node.attrs.src !== this.node.attrs.src || node.attrs.alt !== this.node.attrs.alt
    this.node = node
    if (reload) this.loadImage()
    this.refreshLayout(); return true
  }

  selectNode() {
    if (this.disposed) return
    this.dom.classList.add('md-image-selected'); this.toolbar.hidden = false
    if (!this.selected) {
      this.selected = true
      window.addEventListener('resize', this.schedulePosition)
      document.addEventListener('scroll', this.schedulePosition, true)
      document.addEventListener('focusin', this.schedulePosition)
      document.addEventListener('focusout', this.schedulePosition)
      this.observer = new ResizeObserver(this.schedulePosition)
      this.observer.observe(this.pane); this.observer.observe(this.media); this.observer.observe(this.toolbar)
    }
    this.schedulePosition()
  }

  deselectNode() {
    this.selected = false
    this.dom.classList.remove('md-image-selected'); this.toolbar.hidden = true
    window.removeEventListener('resize', this.schedulePosition)
    document.removeEventListener('scroll', this.schedulePosition, true)
    document.removeEventListener('focusin', this.schedulePosition)
    document.removeEventListener('focusout', this.schedulePosition)
    this.observer?.disconnect(); this.observer = undefined
    cancelAnimationFrame(this.frame); this.frame = 0
  }

  stopEvent(event: Event) { return !(event instanceof KeyboardEvent) }
  ignoreMutation() { return true }
  destroy() {
    this.deselectNode(); this.disposed = true; this.mounted?.destroy()
    this.dom.onclick = this.dom.ondblclick = this.dom.oncontextmenu = this.dom.onmousedown = null
  }
}
