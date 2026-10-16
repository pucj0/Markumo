import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { isTauri } from '@tauri-apps/api/core'
import { imageDestination, type MarkdownResources } from '../images'

export class LiveImageView implements NodeView {
  readonly dom: HTMLElement
  private img: HTMLImageElement | null = null
  private placeholder: HTMLElement
  private objectURL: string | undefined
  private disposed = false
  private generation = 0
  private resourceIdentity: string
  private previewButton=document.createElement('button')

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
    this.dom.append(this.placeholder,this.previewButton)
    this.dom.title='单击编辑图片信息，双击放大预览'
    this.dom.ondblclick=event=>{event.preventDefault();event.stopPropagation();this.openPreview()}

    // Do not blur/collapse the source on pointer-down: that moves the image
    // before the browser delivers click/contextmenu at the original point.
    this.dom.onmousedown = event => event.preventDefault()

    this.dom.onclick = event => {
      event.preventDefault()
      event.stopPropagation()
      const pos = this.getPos()
      if (this.disposed || pos === undefined || this.view.state.doc.nodeAt(pos) !== this.node) return
      this.view.dispatch(
        this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos))
      )
      this.dom.classList.add('md-image-selected')
      this.onEditRequest(this.dom, this.node, pos)
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

  refreshLayout() {
    const pos=this.getPos()
    if(this.disposed||pos===undefined)return
    const parent=this.view.state.doc.resolve(pos).parent
    this.dom.classList.toggle('md-image-standalone',parent.type.name==='paragraph'&&parent.childCount===1&&parent.firstChild?.type.name==='image')
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

    if (!source) {
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
        let bytes: Uint8Array
        try {
          bytes = await this.resources.loadLocal(destination.path)
        } catch (localErr) {
          if (!isTauri()) {
            const rel = destination.path.replace(/^\.\//, '')
            const resp = await fetch(`/tests/fixtures/${rel}`)
            if (resp.ok) {
              const buf = await resp.arrayBuffer()
              bytes = new Uint8Array(buf)
            } else {
              throw localErr
            }
          } else {
            throw localErr
          }
        }
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
        this.placeholder.textContent = `⚠️ 图片无法显示: ${String(error)}`
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
    return true
  }

  selectNode() {
    this.dom.classList.add('md-image-selected')
  }

  deselectNode() {
    this.dom.classList.remove('md-image-selected')
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
