import type { Node } from 'prosemirror-model'
import type { EditorView, NodeView } from 'prosemirror-view'
import { setStaticIcon, textElement } from './safeDom'

export type CalloutType = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION'

export interface CalloutMeta {
  type: CalloutType
  label: string
  color: string
  iconSvg: string
}

export const CALLOUT_TYPES: Record<CalloutType, CalloutMeta> = {
  NOTE: {
    type: 'NOTE',
    label: '说明',
    color: '#3b82f6',
    iconSvg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  },
  TIP: {
    type: 'TIP',
    label: '提示',
    color: '#10b981',
    iconSvg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
  },
  IMPORTANT: {
    type: 'IMPORTANT',
    label: '重要',
    color: '#8b5cf6',
    iconSvg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  },
  WARNING: {
    type: 'WARNING',
    label: '警告',
    color: '#f59e0b',
    iconSvg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  },
  CAUTION: {
    type: 'CAUTION',
    label: '注意',
    color: '#ef4444',
    iconSvg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  },
}

export function normalizeCalloutType(type?: string): CalloutType {
  const upper = (type || 'NOTE').toUpperCase() as CalloutType
  return CALLOUT_TYPES[upper] ? upper : 'NOTE'
}

export class CalloutNodeView implements NodeView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  private header: HTMLElement
  private iconEl: HTMLElement
  private typeBtn: HTMLButtonElement
  private titleEl: HTMLElement
  private typeMenu: HTMLElement | null = null
  private disposed = false

  constructor(
    private node: Node,
    private outer: EditorView,
    private getPos: () => number | undefined,
    private readOnly: () => boolean = () => false
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'md-callout-node'
    this.dom.setAttribute('data-callout', 'true')

    // Header bar
    this.header = document.createElement('div')
    this.header.className = 'md-callout-header'
    this.header.contentEditable = 'false'

    this.iconEl = document.createElement('span')
    this.iconEl.className = 'md-callout-icon'

    this.typeBtn = document.createElement('button')
    this.typeBtn.type = 'button'
    this.typeBtn.className = 'md-callout-type-btn'
    this.typeBtn.title = '切换提示块类型'
    this.typeBtn.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (this.readOnly()) return
      this.toggleTypeMenu()
    }

    this.titleEl = document.createElement('span')
    this.titleEl.className = 'md-callout-title'
    this.titleEl.title = '双击修改标题'
    this.titleEl.ondblclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (this.readOnly()) return
      this.editTitle()
    }

    this.header.append(this.iconEl, this.typeBtn, this.titleEl)

    // Body content container managed by ProseMirror
    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'md-callout-content'

    this.dom.append(this.header, this.contentDOM)
    this.renderMeta()
  }

  private renderMeta() {
    const type = normalizeCalloutType(this.node.attrs.calloutType)
    const meta = CALLOUT_TYPES[type]
    this.dom.className = `md-callout-node md-callout-${type.toLowerCase()}`
    this.dom.setAttribute('data-callout-type', type)

    // Fixed icon templates only; validated before being written as markup.
    setStaticIcon(this.iconEl, meta.iconSvg)
    this.typeBtn.textContent = meta.label

    const customTitle = this.node.attrs.title
    // The custom title is document content and stays plain text.
    this.titleEl.textContent = customTitle || ''
    this.titleEl.style.display = customTitle ? 'inline' : 'none'
  }

  private onOutside = (event: MouseEvent) => {
    const target = event.target as globalThis.Node
    if (!this.header.contains(target) && (!this.typeMenu || !this.typeMenu.contains(target))) {
      this.closeTypeMenu()
    }
  }

  private toggleTypeMenu() {
    if (this.typeMenu) {
      this.closeTypeMenu()
      return
    }
    const menu = document.createElement('div')
    menu.className = 'md-callout-menu'
    menu.setAttribute('data-test-callout-menu', 'true')
    menu.setAttribute('role', 'menu')
    menu.contentEditable = 'false'

    for (const [key, meta] of Object.entries(CALLOUT_TYPES)) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'md-callout-menu-item'
      // Icon from the audited constant table, label as plain text.
      const icon = document.createElement('span')
      icon.className = 'md-callout-menu-icon'
      setStaticIcon(icon, meta.iconSvg)
      item.append(icon, textElement('span', undefined, `${meta.label} (${key})`))
      if (key === normalizeCalloutType(this.node.attrs.calloutType)) {
        item.classList.add('is-active')
      }
      item.onmousedown = (e) => e.preventDefault()
      item.onclick = (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.setType(key as CalloutType)
        this.closeTypeMenu()
      }
      menu.append(item)
    }

    document.addEventListener('mousedown', this.onOutside)
    this.header.append(menu)
    this.typeMenu = menu
  }

  private closeTypeMenu() {
    if (this.typeMenu) {
      document.removeEventListener('mousedown', this.onOutside)
      this.typeMenu.remove()
      this.typeMenu = null
    }
  }

  private setType(type: CalloutType) {
    const pos = this.getPos()
    if (pos === undefined || this.disposed) return
    const tr = this.outer.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      calloutType: type,
    })
    this.outer.dispatch(tr)
    this.outer.focus()
  }

  private editTitle() {
    const current = this.node.attrs.title || ''
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'md-callout-title-input'
    input.value = current
    input.placeholder = '输入自定义标题（留空使用默认类型）'

    const commit = () => {
      input.remove()
      const nextTitle = input.value.trim()
      if (nextTitle !== current) {
        const pos = this.getPos()
        if (pos !== undefined && !this.disposed) {
          const tr = this.outer.state.tr.setNodeMarkup(pos, undefined, {
            ...this.node.attrs,
            title: nextTitle,
          })
          this.outer.dispatch(tr)
        }
      }
      this.renderMeta()
    }

    input.onblur = commit
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        input.value = current
        commit()
      }
    }

    this.titleEl.style.display = 'none'
    this.header.append(input)
    input.focus()
    input.select()
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.renderMeta()
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

  destroy() {
    this.disposed = true
    this.closeTypeMenu()
  }
}
