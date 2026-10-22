import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { imageDestination, type MarkdownResources } from '../images'

export class LiveImageView implements NodeView {
  readonly dom: HTMLElement
  private img: HTMLImageElement | null = null
  private placeholder: HTMLElement
  private objectURL: string | undefined
  private disposed = false
  private generation = 0
  private resourceIdentity: string
  private previewButton = document.createElement('button')
  private toolbar: HTMLElement

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
    this.dom = document.createElement('span')
    this.dom.className = 'md-image-preview md-live-image'
    this.dom.contentEditable = 'false'

    this.placeholder = document.createElement('span')
    this.placeholder.className = 'md-image-placeholder'
    this.previewButton.type='button';this.previewButton.className='md-image-open';this.previewButton.textContent='放大预览';this.previewButton.hidden=true
    this.previewButton.onclick=event=>{event.preventDefault();event.stopPropagation();this.openPreview()}

    this.toolbar = document.createElement('div')
    this.toolbar.className = 'md-image-toolbar'
    this.toolbar.contentEditable = 'false'
    this.toolbar.hidden = true
    this.buildToolbar()

    this.dom.append(this.placeholder, this.toolbar, this.previewButton)
    this.dom.title='单击选中图片工具栏，双击放大预览'
    this.dom.ondblclick=event=>{event.preventDefault();event.stopPropagation();this.openPreview()}

    this.dom.onmousedown = event => {
      if (this.toolbar.contains(event.target as globalThis.Node)) return
      const pos = this.getPos()
      if (pos !== undefined && !this.disposed) {
        this.view.dispatch(
          this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos))
        )
        this.selectNode()
      }
    }

    this.dom.onclick = event => {
      if (this.toolbar.contains(event.target as globalThis.Node)) return
      event.preventDefault()
      event.stopPropagation()
      const pos = this.getPos()
      if (this.disposed || pos === undefined || this.view.state.doc.nodeAt(pos) !== this.node) return
      this.view.dispatch(
        this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos))
      )
      this.selectNode()
    }
    this.dom.oncontextmenu = event => {
      const pos = this.getPos()
      if (this.disposed || pos === undefined || this.view.state.doc.nodeAt(pos) !== this.node || !this.onPropertiesRequest) return
      event.preventDefault(); event.stopPropagation()
      this.onPropertiesRequest(this.dom, this.node, pos)
    }

    void this.loadImage()
    queueMicrotask(() => { if (!this.disposed) this.refreshLayout() })
  }

  private buildToolbar() {
    // Alignment buttons: Left, Center, Right
    const aligns: { id: 'left' | 'center' | 'right'; label: string; icon: string }[] = [
      { id: 'left', label: '左对齐', icon: '⇤' },
      { id: 'center', label: '居中', icon: '⇋' },
      { id: 'right', label: '右对齐', icon: '⇥' },
    ]
    for (const a of aligns) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = `md-img-tool-btn md-img-align-${a.id}`
      btn.title = a.label
      btn.textContent = a.icon
      btn.onclick = (e) => {
        e.preventDefault()
        e.stopPropagation()
        const nextAlign = this.node.attrs.align === a.id ? null : a.id
        this.applyAttributes(this.node.attrs.width, nextAlign)
      }
      this.toolbar.append(btn)
    }

    const sep1 = document.createElement('span')
    sep1.className = 'md-img-tool-sep'
    this.toolbar.append(sep1)

    // Width buttons: 25%, 50%, 75%, 100%, Auto
    const widths: { id: string | null; label: string }[] = [
      { id: '25%', label: '25%' },
      { id: '50%', label: '50%' },
      { id: '75%', label: '75%' },
      { id: '100%', label: '100%' },
      { id: null, label: '原图' },
    ]
    for (const w of widths) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = `md-img-tool-btn md-img-width-${w.id ? w.id.replace('%', '') : 'auto'}`
      btn.title = `宽度 ${w.label}`
      btn.textContent = w.label
      btn.onclick = (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.applyAttributes(w.id, this.node.attrs.align)
      }
      this.toolbar.append(btn)
    }

    const sep2 = document.createElement('span')
    sep2.className = 'md-img-tool-sep'
    this.toolbar.append(sep2)

    // Preview button
    const prevBtn = document.createElement('button')
    prevBtn.type = 'button'
    prevBtn.className = 'md-img-tool-btn md-img-tool-preview'
    prevBtn.title = '放大预览'
    prevBtn.textContent = '🔍'
    prevBtn.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.openPreview()
    }
    this.toolbar.append(prevBtn)

    // Edit path button
    const editBtn = document.createElement('button')
    editBtn.type = 'button'
    editBtn.className = 'md-img-tool-btn md-img-tool-edit'
    editBtn.title = '编辑图片路径'
    editBtn.textContent = '✏️'
    editBtn.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      const pos = this.getPos()
      if (pos !== undefined) this.onEditRequest(this.dom, this.node, pos)
    }
    this.toolbar.append(editBtn)

    // Delete button
    const delBtn = document.createElement('button')
    delBtn.type = 'button'
    delBtn.className = 'md-img-tool-btn md-img-tool-delete'
    delBtn.title = '删除图片'
    delBtn.textContent = '🗑️'
    delBtn.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.deleteImage()
    }
    this.toolbar.append(delBtn)
  }

  private applyAttributes(width: string | null, align: string | null) {
    const pos = this.getPos()
    if (pos === undefined || this.disposed) return
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      width,
      align,
    }).setMeta('isolated', true)
    this.view.dispatch(tr)
    this.selectNode()
    this.view.focus()
  }

  private deleteImage() {
    const pos = this.getPos()
    if (pos === undefined || this.disposed) return
    const doc = this.view.state.doc
    const $pos = doc.resolve(pos)
    const parent = $pos.parent
    const isStandalone = parent.type.name === 'paragraph' && parent.childCount === 1
    let tr = this.view.state.tr
    if (isStandalone && (doc.childCount > 1 || $pos.depth > 1)) {
      tr = tr.delete($pos.before(), $pos.after())
    } else {
      tr = tr.delete(pos, pos + this.node.nodeSize)
    }
    this.view.dispatch(tr.setMeta('isolated', true).scrollIntoView())
    this.view.focus()
  }

  refreshLayout() {
    const pos = this.getPos()
    if (this.disposed || pos === undefined) return
    const parent = this.view.state.doc.resolve(pos).parent
    this.dom.classList.toggle('md-image-standalone', parent.type.name === 'paragraph' && parent.childCount === 1 && parent.firstChild?.type.name === 'image')

    const width = this.node.attrs.width
    const align = this.node.attrs.align
    if (width) {
      const w = String(width).endsWith('%') || String(width).endsWith('px') ? width : `${width}px`
      this.dom.style.width = w
      this.dom.style.maxWidth = '100%'
    } else {
      this.dom.style.width = ''
      this.dom.style.maxWidth = ''
    }

    if (align === 'center') {
      this.dom.style.display = 'block'
      this.dom.style.margin = '0 auto'
      this.dom.style.textAlign = 'center'
    } else if (align === 'right') {
      this.dom.style.display = 'block'
      this.dom.style.margin = '0 0 0 auto'
      this.dom.style.textAlign = 'right'
    } else if (align === 'left') {
      this.dom.style.display = 'block'
      this.dom.style.margin = '0 auto 0 0'
      this.dom.style.textAlign = 'left'
    } else {
      this.dom.style.display = ''
      this.dom.style.margin = ''
      this.dom.style.textAlign = ''
    }
  }

  private openPreview(){
    if(!this.img?.naturalWidth || this.disposed)return
    const expected=this.node
    this.onPreviewRequest?.(this.img,()=>{if(this.disposed)return false;const pos=this.getPos();return pos!==undefined&&this.view.state.doc.nodeAt(pos)===expected})
  }

  async loadImage() {
    this.previewButton.hidden=true
    const current = ++this.generation
    const source = this.node.attrs.src || ''
    const alt = this.node.attrs.alt || ''
    const destination = imageDestination(source)

    if (this.objectURL) {
      URL.revokeObjectURL(this.objectURL)
      this.objectURL = undefined
    }

    if (this.img) {
      this.img.remove()
      this.img = null
    }

    if (!source || (source === 'image.png' && alt === '图片描述')) {
      this.placeholder.textContent = '🖼️ (空图片路径)'
      this.placeholder.hidden = false
      return
    }

    this.placeholder.textContent = '图片加载中…'
    this.placeholder.hidden = false

    try {
      let src: string

      if (destination.kind === 'blocked') {
        this.placeholder.textContent = '🚫 路径未获允许'
        return
      }

      if (destination.kind === 'remote') {
        if (!this.resources.allowedRemote.has(destination.path)) {
          this.placeholder.textContent = `🌐 点击加载网络图片 (${new URL(destination.path).hostname})`
          this.placeholder.onclick = e => {
            e.stopPropagation()
            this.resources.allowedRemote.add(destination.path)
            void this.loadImage()
          }
          return
        }
        src = destination.path
      } else {
        const bytes = await this.resources.loadLocal(destination.path)
        if (this.disposed || current !== this.generation) return
        const type =
          bytes[0] === 0x89
            ? 'image/png'
            : bytes[0] === 0xff
            ? 'image/jpeg'
            : bytes[0] === 0x47
            ? 'image/gif'
            : 'image/webp'
        this.objectURL = URL.createObjectURL(new Blob([bytes], { type }))
        src = this.objectURL
      }

      if (this.disposed || current !== this.generation) return

      const img = document.createElement('img')
      img.alt = alt
      img.referrerPolicy = 'no-referrer'
      img.decoding = 'async'
      if (destination.kind === 'remote') img.crossOrigin = 'anonymous'

      img.onload = () => {
        if (this.disposed || current !== this.generation) return
        this.dom.classList.remove('is-broken-image')
        this.placeholder.hidden = true
        this.previewButton.hidden = !this.onPreviewRequest
      }

      img.onerror = () => {
        if (this.disposed || current !== this.generation) return
        this.placeholder.textContent = '⚠️ 图片加载失败'
        this.placeholder.hidden = false
        if (this.img) this.img.remove()
      }

      this.img = img
      this.dom.prepend(img)
      img.src = src
    } catch (error) {
      if (this.disposed || current !== this.generation) return
      const isScope =
        typeof error === 'object' && error && 'code' in error && error.code === 'image_scope'
      if (isScope && this.resources.authorizeLocal) {
        this.placeholder.textContent = '🔒 点击授权访问此图片…'
        this.placeholder.onclick = async e => {
          e.stopPropagation()
          try {
            if (await this.resources.authorizeLocal!(destination.path)) {
              void this.loadImage()
            }
          } catch (err) {
            this.placeholder.textContent = `授权失败: ${String(err)}`
          }
        }
      } else {
        this.dom.classList.add('is-broken-image')
        this.placeholder.className = 'md-image-placeholder broken-image-tag'
        this.placeholder.innerHTML = `<svg class="broken-image-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15l-5-5L5 21"/><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><line x1="2" y1="2" x2="22" y2="22"/></svg><span class="broken-image-text">${alt || source || '图片失效'}</span>`
        this.placeholder.title = `图片无法显示: ${String(error)}`
        this.placeholder.onclick = (e) => {
          e.stopPropagation()
          const pos = this.getPos()
          if (pos !== undefined) this.onEditRequest(this.dom, this.node, pos)
        }
      }
    }
  }

  refreshResource() {
    const current = this.resources.identity()
    if (current !== this.resourceIdentity) {
      this.resourceIdentity = current
      void this.loadImage()
    }
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    const changed = node.attrs.src !== this.node.attrs.src
    this.node = node
    if (this.img) {
      this.img.alt = node.attrs.alt || ''
    }
    if (changed) {
      void this.loadImage()
    }
    this.refreshLayout()
    return true
  }

  selectNode() {
    this.dom.classList.add('md-image-selected')
    this.toolbar.hidden = false
  }

  deselectNode() {
    this.dom.classList.remove('md-image-selected')
    this.toolbar.hidden = true
  }

  stopEvent(_event: Event) {
    return true
  }

  ignoreMutation() {
    // This atom has no contentDOM: image loading, selection and layout only
    // mutate its presentation. Re-parsing those mutations calls update(),
    // which writes image attributes/styles again and can loop indefinitely.
    // Document edits go through explicit transactions in the toolbar handlers.
    return true
  }

  destroy() {
    this.dom.onclick=null;this.dom.ondblclick=null;this.dom.oncontextmenu=null
    this.disposed = true
    this.generation++
    if (this.objectURL) {
      URL.revokeObjectURL(this.objectURL)
      this.objectURL = undefined
    }
    if (this.img) {
      this.img.onload = null
      this.img.onerror = null
    }
  }
}
