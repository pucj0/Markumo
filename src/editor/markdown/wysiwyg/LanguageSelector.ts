import { languageRegistry, parseFenceInfo, resolveLanguage } from '../../languages'

let identity = 0
export class LanguageSelector {
  readonly dom = document.createElement('div')
  readonly button = document.createElement('button')
  private panel = document.createElement('div')
  private input = document.createElement('input')
  private list = document.createElement('div')
  private options: { id: string; label: string }[] = []
  private active = 0
  private info = ''
  private onOutside = (event: MouseEvent) => { if (!this.dom.contains(event.target as Node)) this.close() }
  private onViewportChange = (event: Event) => { if (!this.panel.hidden && (!(event.target instanceof Node) || !this.panel.contains(event.target))) this.position() }

  constructor(info: string, private change: (label: string) => void) {
    this.dom.className = 'md-code-lang'
    this.button.type = 'button'
    this.button.setAttribute('aria-haspopup', 'listbox')
    this.panel.className = 'md-language-menu'
    this.panel.hidden = true
    this.input.className = 'md-code-lang-input'
    this.input.setAttribute('aria-label', '搜索代码语言')
    this.input.setAttribute('role', 'combobox')
    this.input.setAttribute('aria-autocomplete', 'list')
    this.list.id = `md-language-options-${++identity}`
    this.list.setAttribute('role', 'listbox')
    this.list.setAttribute('aria-label', '代码语言选项')
    this.input.setAttribute('aria-controls', this.list.id)
    this.panel.append(this.input, this.list)
    this.dom.append(this.button, this.panel)
    this.button.onclick = () => this.panel.hidden ? this.open() : this.close()
    this.input.oninput = () => { this.active = 0; this.filter() }
    this.panel.onkeydown = event => {
      if (event.isComposing) return
      if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation()
        if (event.key === 'Escape') { this.close(); this.button.focus() }
        else if (event.key === 'Enter') this.choose(this.options[this.active]?.id)
        else if(this.options.length) { this.active = (this.active + (event.key === 'ArrowDown' ? 1 : -1) + this.options.length) % this.options.length; this.paint() }
      }
    }
    this.dom.addEventListener('focusout', () => queueMicrotask(() => { if (!this.dom.contains(document.activeElement)) this.close() }))
    document.addEventListener('mousedown', this.onOutside)
    document.addEventListener('scroll', this.onViewportChange, true)
    window.addEventListener('resize', this.onViewportChange)
    this.update(info)
  }
  update(info: string) {
    this.info = info
    const { label, language } = parseFenceInfo(info)
    this.button.textContent = language?.name || label || '语言'
    this.button.setAttribute('aria-label', `代码语言：${language?.name || label || '未指定'}`)
    this.button.title = label && !language ? `${label} 未注册，当前使用纯文本高亮` : '选择代码语言'
    this.dom.dataset.language = language?.id || 'text'
  }
  private open() {
    this.panel.hidden = false
    this.button.setAttribute('aria-expanded', 'true')
    this.input.setAttribute('aria-expanded', 'true')
    this.input.value = ''
    this.active = 0; this.filter(); this.input.focus()
    this.position()
  }
  private position() {
    const anchor = this.button.getBoundingClientRect()
    const width = Math.min(260, window.innerWidth - 16)
    this.panel.style.width = `${width}px`
    this.panel.style.left = `${Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))}px`
    const below = window.innerHeight - anchor.bottom - 8
    const above = anchor.top - 8
    const height = Math.min(236, Math.max(below, above))
    this.panel.style.maxHeight = `${height}px`
    this.panel.style.top = `${below >= Math.min(236, above) ? anchor.bottom + 2 : Math.max(8, anchor.top - Math.min(this.panel.scrollHeight, height) - 2)}px`
  }
  private close() {
    this.panel.hidden = true
    this.button.setAttribute('aria-expanded', 'false')
    this.input.setAttribute('aria-expanded', 'false')
  }
  private filter() {
    const query = this.input.value.trim().toLowerCase()
    this.options = languageRegistry.filter(language => [language.id, language.name, ...language.aliases].some(alias => alias.toLowerCase().includes(query)))
      .map(language => ({ id: language.id === 'text' ? 'text' : language.id, label: language.name }))
    if (query && !resolveLanguage(query) && !/[\s`~]/.test(query)) this.options.push({ id: query, label: `${query}（未注册，纯文本）` })
    this.paint()
  }
  private paint() {
    this.list.replaceChildren()
    this.options.forEach((option, index) => {
      const row = document.createElement('button')
      row.type = 'button'; row.textContent = option.label; row.setAttribute('role', 'option')
      row.id = `${this.list.id}-${index}`; row.setAttribute('aria-selected', String(index === this.active))
      row.onmousedown = event => event.preventDefault()
      row.onclick = () => this.choose(option.id)
      this.list.append(row)
    })
    if(this.options.length)this.input.setAttribute('aria-activedescendant', `${this.list.id}-${this.active}`)
    else this.input.removeAttribute('aria-activedescendant')
    const row = this.list.children[this.active] as HTMLElement | undefined
    if (row) {
      if (row.offsetTop < this.list.scrollTop) this.list.scrollTop = row.offsetTop
      else if (row.offsetTop + row.offsetHeight > this.list.scrollTop + this.list.clientHeight) this.list.scrollTop = row.offsetTop + row.offsetHeight - this.list.clientHeight
    }
  }
  private choose(label?: string) {
    if (!label) return
    this.close()
    const suffix = parseFenceInfo(this.info).parameters
    this.change(label + suffix)
    this.button.focus()
  }
  destroy() { document.removeEventListener('mousedown', this.onOutside); document.removeEventListener('scroll', this.onViewportChange, true); window.removeEventListener('resize', this.onViewportChange); this.dom.remove() }
}
