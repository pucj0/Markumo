import './LiveContextMenu.css'

export interface LiveMenuItem {
  label: string
  shortcut?: string
  icon?: string
  checked?: boolean
  pressed?: boolean
  disabled?: boolean
  run?: () => void | Promise<void>
  children?: LiveMenuEntry[]
}
export type LiveMenuEntry = LiveMenuItem | { icons: LiveMenuItem[] } | 'separator'

// Fixed, application-owned SVG paths; labels and document text use textContent.
const paths: Record<string, string> = {
  cut: 'M8 8 20 20M14 10l6-6M8 16l3-3M5 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6M5 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  copy: 'M9 9h12v12H9zM15 9V3H3v12h6',
  paste: 'M9 5H5v17h14V5h-4M9 2h6v5H9zM8 12h8M8 16h8',
  delete: 'M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  bold: 'M7 3h6a5 5 0 0 1 0 9H7V3m0 9h7a5 5 0 0 1 0 9H7v-9',
  italic: 'M10 3h10M4 21h10M15 3 9 21',
  code: 'm8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18',
  link: 'm10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 2 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  quote: 'M3 5h7v8H3zm0 8v6l7-6M14 5h7v8h-7zm0 8v6l7-6',
  ordered: 'M10 5h12M10 12h12M10 19h12M2 3h2v5M2 11c4-2 4 1 0 4h4M2 18h4l-2 2 2 1H2',
  bullet: 'M10 5h12M10 12h12M10 19h12M3 5h1M3 12h1M3 19h1',
  task: 'M4 4h16v16H4zM7 12l3 3 7-7',
}

export class LiveContextMenu {
  private root: HTMLElement | null = null
  private panels = new Set<HTMLElement>()
  constructor(private error: (error: unknown) => void, private restoreFocus: () => void) {}

  private outside = (event: Event) => {
    if (event.target instanceof Node && ![...this.panels].some(panel => panel.contains(event.target as Node))) this.close()
  }
  owns(target: Node) { return [...this.panels].some(panel => panel.contains(target)) }
  private reposition = (event: Event) => {
    if (event.type === 'scroll' && event.target instanceof Node && this.owns(event.target)) {
      if (event.target === this.root) {
        for (const panel of this.panels) if (panel !== this.root) { panel.remove(); this.panels.delete(panel) }
        this.root.querySelectorAll('[aria-expanded]').forEach(button => button.setAttribute('aria-expanded', 'false'))
      }
      return
    }
    this.close()
  }

  close() {
    for (const panel of this.panels) panel.remove()
    this.panels.clear()
    this.root = null
    document.removeEventListener('pointerdown', this.outside, true)
    window.removeEventListener('resize', this.reposition)
    window.removeEventListener('blur', this.reposition)
    document.removeEventListener('scroll', this.reposition, true)
  }

  open(x: number, y: number, entries: LiveMenuEntry[], keyboard = false) {
    this.close()
    const root = this.panel(entries)
    this.root = root
    this.place(root, x, y)
    document.addEventListener('pointerdown', this.outside, true)
    window.addEventListener('resize', this.reposition)
    window.addEventListener('blur', this.reposition)
    document.addEventListener('scroll', this.reposition, true)
    if (keyboard) root.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }

  private place(panel: HTMLElement, x: number, y: number) {
    panel.style.left = `${Math.max(4, Math.min(x, window.innerWidth - panel.offsetWidth - 4))}px`
    panel.style.top = `${Math.max(4, Math.min(y, window.innerHeight - panel.offsetHeight - 4))}px`
  }

  private panel(entries: LiveMenuEntry[], parent?: HTMLButtonElement): HTMLElement {
    const menu = document.createElement('div')
    menu.className = 'md-context-menu'
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', parent?.textContent || '富文本编辑')
    menu.onmousedown = event => event.preventDefault() // Preserve PM/CM selection.
    let child: HTMLElement | null = null
    const closeChild = () => {
      if (!child) return
      const children = [...this.panels].filter(panel => panel !== menu && panel !== this.root)
      // Descendant menus are appended in depth order.
      const index = children.indexOf(child)
      for (const panel of children.slice(index < 0 ? children.length : index)) { panel.remove(); this.panels.delete(panel) }
      child = null
      menu.querySelectorAll('[aria-expanded]').forEach(button => button.setAttribute('aria-expanded', 'false'))
    }
    const button = (item: LiveMenuItem, compact = false) => {
      const element = document.createElement('button')
      element.type = 'button'
      element.className = compact ? 'md-context-icon' : 'md-context-item'
      element.setAttribute('role', item.checked !== undefined ? 'menuitemradio' : 'menuitem')
      if (item.checked !== undefined) element.setAttribute('aria-checked', String(item.checked))
      element.disabled = !!item.disabled
      element.title = item.label + (item.shortcut ? ` (${item.shortcut})` : '')
      element.setAttribute('aria-label', item.label)
      if (compact && item.pressed !== undefined) element.setAttribute('aria-pressed', String(item.pressed))
      if (compact && item.icon && paths[item.icon]) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true')
        const path = document.createElementNS(svg.namespaceURI, 'path')
        path.setAttribute('d', paths[item.icon]); svg.append(path); element.append(svg)
      } else {
        const tick = document.createElement('span'); tick.className = 'md-context-check'; tick.textContent = item.checked ? '✓' : ''
        const label = document.createElement('span'); label.textContent = item.label
        element.append(tick, label)
        const hint = document.createElement('span'); hint.className = 'md-context-hint'; hint.textContent = item.children ? '›' : item.shortcut || ''
        element.append(hint)
      }
      const expand = () => {
        if (element.disabled) return
        if (item.children && element.getAttribute('aria-expanded') === 'true') return
        closeChild()
        if (!item.children) return
        child = this.panel(item.children, element)
        element.setAttribute('aria-expanded', 'true')
        const rect = element.getBoundingClientRect()
        const left = rect.right + child.offsetWidth + 5 > window.innerWidth ? rect.left - child.offsetWidth - 3 : rect.right + 3
        this.place(child, left, rect.top - 5)
      }
      element.onpointerenter = expand
      element.onfocus = expand
      if (item.children) { element.setAttribute('aria-haspopup', 'menu'); element.setAttribute('aria-expanded', 'false') }
      element.onclick = () => {
        if (item.children) { expand(); child?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); return }
        this.close(); this.restoreFocus()
        try { Promise.resolve(item.run?.()).catch(this.error) } catch (error) { this.error(error) }
      }
      element.onkeydown = event => {
        if (event.key === 'ArrowRight' && item.children) {
          event.preventDefault(); event.stopPropagation(); expand(); child?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
        }
      }
      return element
    }
    for (const entry of entries) {
      if (entry === 'separator') { const hr = document.createElement('div'); hr.className = 'md-context-separator'; hr.setAttribute('role', 'separator'); menu.append(hr) }
      else if ('icons' in entry) {
        const row = document.createElement('div'); row.className = 'md-context-icons'; row.setAttribute('role', 'group')
        row.append(...entry.icons.map(item => button(item, true))); menu.append(row)
      } else menu.append(button(entry))
    }
    menu.onkeydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); this.restoreFocus(); return }
      if (event.key === 'Tab') { this.close(); return }
      if (event.key === 'ArrowLeft' && parent) {
        event.preventDefault(); event.stopPropagation(); parent.focus(); parent.setAttribute('aria-expanded', 'false'); menu.remove(); this.panels.delete(menu); return
      }
      const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'ArrowDown' ? (current + 1) % buttons.length : event.key === 'ArrowUp' ? (current + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1
      if (next >= 0) { event.preventDefault(); event.stopPropagation(); buttons[next]?.focus() }
    }
    document.body.append(menu); this.panels.add(menu)
    return menu
  }
}
