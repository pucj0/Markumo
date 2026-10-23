import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { mountMarkdownImage, type MarkdownResources } from '../images'

/** The picture stays mounted while the controller edits its complete source. */
export class LiveImageView implements NodeView {
  readonly dom = document.createElement('span')
  private media = document.createElement('span')
  private size = document.createElement('select')
  private browse = document.createElement('button')
  private mounted?: ReturnType<typeof mountMarkdownImage>
  private disposed = false
  private selected = false
  private resourceIdentity: string

  constructor(
    private node: PMNode,
    private view: EditorView,
    readonly getPos: () => number | undefined,
    private resources: MarkdownResources,
    private onEdit: (pos: number, selectAll: boolean) => void,
    private onBrowse: (commit: (src: string | null) => void) => void,
    private onUpdate: (pos: number, attrs: Record<string, unknown>) => void,
  ) {
    this.resourceIdentity = resources.identity()
    this.dom.className = 'md-image-preview md-live-image'
    this.dom.contentEditable = 'false'
    this.dom.title = '单击编辑图片源码，双击选择整段源码，右键更多操作'
    this.media.className = 'md-image-media'
    this.size.className = 'md-image-width'
    this.size.setAttribute('aria-label', '图片缩放百分比')
    this.size.setAttribute('data-image-width', '')
    for (const percent of [25, 33, 50, 67, 80, 100, 150, 200]) this.size.add(new Option(`${percent}%`, String(percent)))
    this.size.onchange = () => {
      const pos = this.getPos()
      if (pos !== undefined) this.onUpdate(pos, { zoom: Number(this.size.value) })
    }
    this.browse.type = 'button'
    this.browse.className = 'md-image-browse'
    this.browse.setAttribute('aria-label', '选择图片文件')
    this.browse.textContent = '📁'
    this.browse.onclick = event => {
      event.preventDefault(); event.stopPropagation()
      const expected = this.node
      this.onBrowse(src => {
        const pos = this.getPos()
        if (src && !this.disposed && pos !== undefined && this.view.state.doc.nodeAt(pos) === expected) this.onUpdate(pos, { src })
      })
    }
    this.dom.append(this.media, this.size, this.browse)
    // Source gestures belong to the separate raw text widget, never this atom.
    this.dom.onmousedown = event => {
      if (event.button !== 0 || (event.target as Element).closest('select,button')) return
      event.preventDefault()
    }
    this.dom.onclick = event => {
      if ((event.target as Element).closest('select,button')) return
      event.preventDefault(); event.stopPropagation(); this.edit(false)
    }
    this.dom.ondblclick = event => {
      if ((event.target as Element).closest('select,button')) return
      event.preventDefault(); event.stopPropagation(); this.edit(true)
    }
    this.loadImage()
    queueMicrotask(() => { if (!this.disposed) this.refreshLayout() })
  }

  private edit(selectAll: boolean) {
    const pos = this.getPos()
    if (this.disposed || !this.view.editable || pos === undefined || this.view.state.doc.nodeAt(pos) !== this.node) return
    const selection = this.view.state.selection
    if (!(selection instanceof NodeSelection) || selection.from !== pos) this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)))
    this.onEdit(pos, selectAll)
  }

  loadImage() {
    this.mounted?.destroy()
    this.mounted = mountMarkdownImage(this.media, this.node.attrs.src ?? '', this.node.attrs.alt ?? '', this.resources,
      () => this.edit(false), () => {
        this.dom.classList.toggle('is-broken-image', this.media.classList.contains('is-broken-image'))
        this.refreshLayout()
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
    const width = this.node.attrs.width === 'auto' ? null : this.node.attrs.width
    const align = this.node.attrs.align
    this.dom.classList.toggle('md-image-standalone', standalone)
    this.dom.classList.toggle('md-image-sized', !!width)
    this.dom.style.width = width ? /(?:%|px)$/.test(String(width)) ? String(width) : `${width}px` : standalone && align ? 'fit-content' : ''
    this.dom.style.display = standalone && align ? 'block' : ''
    this.dom.style.margin = standalone && align ? align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : '0 auto 0 0' : ''
    this.dom.style.textAlign = standalone ? align ?? '' : ''
    this.dom.dataset.imageAlign = standalone ? align ?? '' : ''
    const image = this.media.querySelector('img')
    if (image) image.style.setProperty('zoom', this.node.attrs.zoom ? `${this.node.attrs.zoom}%` : '')
    const zoom = String(this.node.attrs.zoom ?? 100)
    for (const option of Array.from(this.size.options)) if ('custom' in option.dataset) option.remove()
    if (!Array.from(this.size.options).some(option => option.value === zoom)) {
      const option = new Option(`${zoom}%`, zoom); option.dataset.custom = ''; this.size.add(option)
    }
    this.size.value = zoom
    this.size.hidden = !this.selected || !this.view.editable || !image
    this.browse.hidden = !this.selected || !this.view.editable || !!this.node.attrs.src
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    const reload = node.attrs.src !== this.node.attrs.src || node.attrs.alt !== this.node.attrs.alt
    this.node = node
    if (reload) this.loadImage()
    this.refreshLayout()
    return true
  }

  selectNode() { this.selected = true; this.dom.classList.add('md-image-selected'); this.refreshLayout() }
  deselectNode() { this.selected = false; this.dom.classList.remove('md-image-selected'); this.refreshLayout() }
  stopEvent(event: Event) {
    if (event.type === 'contextmenu') return false
    return !(event instanceof KeyboardEvent) || (event.target instanceof Element && !!event.target.closest('select,button'))
  }
  ignoreMutation() { return true }
  destroy() {
    this.disposed = true
    this.mounted?.destroy()
    this.dom.onclick = this.dom.ondblclick = this.dom.onmousedown = null
    this.size.onchange = null
    this.browse.onclick = null
  }
}
