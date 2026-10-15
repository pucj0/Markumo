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

  constructor(
    private node: PMNode,
    private view: EditorView,
    readonly getPos: () => number | undefined,
    private resources: MarkdownResources,
    private onEditRequest: (imgEl: HTMLElement, node: PMNode, pos: number) => void
  ) {
    this.resourceIdentity = resources.identity()
    this.dom = document.createElement('span')
    this.dom.className = 'md-image-preview md-live-image'
    this.dom.contentEditable = 'false'

    this.placeholder = document.createElement('span')
    this.placeholder.className = 'md-image-placeholder'
    this.dom.append(this.placeholder)

    this.dom.onclick = event => {
      event.preventDefault()
      event.stopPropagation()
      const pos = this.getPos()
      if (pos === undefined) return
      this.view.dispatch(
        this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos))
      )
      this.dom.classList.add('md-image-selected')
      this.onEditRequest(this.img || this.dom, this.node, pos)
    }

    void this.loadImage()
  }

  async loadImage() {
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
    const changed = node.attrs.src !== this.node.attrs.src || node.attrs.alt !== this.node.attrs.alt
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
