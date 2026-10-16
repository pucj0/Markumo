import { getLanguageSuggestions, createLanguageIconSvg, type LanguageOption } from '../../languages/suggestions'

export interface AutocompleteCallbacks {
  onCommit: (language: string, fence: string) => void
  onTabComplete: (language: string, fence: string) => void
}

export class FenceAutocomplete {
  private readonly dom = document.createElement('div')
  private readonly list = document.createElement('div')
  private options: LanguageOption[] = []
  private selectedIndex = -1 // -1 表示用户尚未明确使用方向键选择某项
  private query = ''
  private fence = '```'
  private callbacks?: AutocompleteCallbacks
  private visible = false

  constructor(private container: HTMLElement) {
    this.dom.className = 'md-fence-autocomplete'
    this.dom.hidden = true
    this.dom.setAttribute('role', 'listbox')
    this.dom.setAttribute('aria-label', '代码语言补全建议')
    this.list.className = 'md-language-list'
    this.dom.append(this.list)
    this.container.append(this.dom)

    this.dom.onmousedown = event => {
      // 阻止失焦
      event.preventDefault()
    }
  }

  get isVisible() {
    return this.visible && !this.dom.hidden
  }

  show(
    coords: { left: number; bottom: number; top: number; right?: number },
    query: string,
    fence: string,
    callbacks: AutocompleteCallbacks
  ) {
    this.query = query
    this.fence = fence
    this.callbacks = callbacks
    this.options = getLanguageSuggestions(query, false)

    if (this.options.length === 0) {
      this.hide()
      return
    }

    // 默认不主动高亮任何项（selectedIndex = -1），避免直接按 Enter 时误选
    this.selectedIndex = -1
    this.render()

    this.dom.hidden = false
    this.visible = true
    this.position(coords)
  }

  hide() {
    this.visible = false
    this.dom.hidden = true
    this.selectedIndex = -1
    this.options = []
  }

  private position(coords: { left: number; bottom: number; top: number }) {
    const width = 220
    const listHeight = Math.min(220, this.options.length * 32 + 8)
    const padding = 8

    // 水平位置：尽量与光标对齐，但不超出右侧屏幕
    let left = coords.left
    if (left + width > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - width - padding)
    }

    // 垂直位置：优先下方，若下方空间不足则翻转到上方
    const spaceBelow = window.innerHeight - coords.bottom - padding
    const spaceAbove = coords.top - padding

    let top: number
    if (spaceBelow >= listHeight || spaceBelow >= spaceAbove) {
      top = coords.bottom + 4
      this.dom.style.maxHeight = `${Math.max(80, spaceBelow - 8)}px`
    } else {
      top = Math.max(padding, coords.top - Math.min(listHeight, spaceAbove) - 4)
      this.dom.style.maxHeight = `${Math.max(80, spaceAbove - 8)}px`
    }

    this.dom.style.left = `${left}px`
    this.dom.style.top = `${top}px`
    this.dom.style.width = `${width}px`
  }

  private render() {
    this.list.replaceChildren()
    this.options.forEach((opt, index) => {
      const item = document.createElement('div')
      item.className = 'md-language-option'
      item.setAttribute('role', 'option')
      item.setAttribute('aria-label', opt.name)
      item.setAttribute('aria-selected', String(index === this.selectedIndex))
      if (index === this.selectedIndex) {
        item.classList.add('is-active')
      }

      const icon = createLanguageIconSvg(opt.id)
      const name = document.createElement('span')
      name.className = 'md-language-name'
      name.textContent = opt.name

      item.append(icon, name)

      item.onclick = (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.callbacks?.onCommit(opt.id, this.fence)
        this.hide()
      }

      this.list.append(item)
    })
  }

  private updateActiveItem() {
    const children = Array.from(this.list.children) as HTMLElement[]
    children.forEach((child, index) => {
      const active = index === this.selectedIndex
      child.setAttribute('aria-selected', String(active))
      if (active) {
        child.classList.add('is-active')
        if (child.offsetTop < this.dom.scrollTop) {
          this.dom.scrollTop = child.offsetTop
        } else if (child.offsetTop + child.offsetHeight > this.dom.scrollTop + this.dom.clientHeight) {
          this.dom.scrollTop = child.offsetTop + child.offsetHeight - this.dom.clientHeight
        }
      } else {
        child.classList.remove('is-active')
      }
    })
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.isVisible || this.options.length === 0) return false

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      if (this.selectedIndex === -1) {
        this.selectedIndex = 0
      } else {
        this.selectedIndex = (this.selectedIndex + 1) % this.options.length
      }
      this.updateActiveItem()
      return true
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      if (this.selectedIndex === -1) {
        this.selectedIndex = this.options.length - 1
      } else {
        this.selectedIndex = (this.selectedIndex - 1 + this.options.length) % this.options.length
      }
      this.updateActiveItem()
      return true
    }

    if (event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      // Tab 补全：若有明确选中的项则取该项，否则取第 1 项
      const targetOption = this.selectedIndex >= 0 ? this.options[this.selectedIndex] : this.options[0]
      if (targetOption) {
        this.callbacks?.onTabComplete(targetOption.id, this.fence)
      }
      this.hide()
      return true
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.hide()
      return true
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      // 重要规则：
      // 只有用户明确通过方向键选中了候选（selectedIndex >= 0）时，才使用候选语言；
      // 如果用户没有明确选择某项，直接使用用户输入的 query 作为语言标识创建代码块！
      const chosenLanguage = this.selectedIndex >= 0
        ? this.options[this.selectedIndex].id
        : this.query
      this.callbacks?.onCommit(chosenLanguage, this.fence)
      this.hide()
      return true
    }

    return false
  }

  destroy() {
    this.hide()
    this.dom.remove()
  }
}
