import { TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import {
  liveSearchPluginKey,
  type LiveSearchOptions,
  type LiveSearchState,
} from './plugins/LiveSearch'
import type { CodeBlockView } from './CodeBlockView'

export class LiveSearchController {
  readonly dom: HTMLElement
  private searchInput: HTMLInputElement
  private replaceInput: HTMLInputElement
  private countLabel: HTMLElement
  private caseCheckbox: HTMLInputElement
  private wordCheckbox: HTMLInputElement
  private regexCheckbox: HTMLInputElement
  private secondRow: HTMLElement
  private toggleButton: HTMLButtonElement
  private syncTimer: ReturnType<typeof setTimeout> | undefined
  private codeViewsGetter: () => Set<CodeBlockView>

  constructor(
    private view: EditorView,
    parent: HTMLElement,
    codeViewsGetter: () => Set<CodeBlockView>
  ) {
    this.codeViewsGetter = codeViewsGetter

    this.dom = document.createElement('div')
    this.dom.className = 'md-live-search fleet-search'
    this.dom.setAttribute('role', 'search')
    this.dom.setAttribute('aria-label', 'Markdown 实时查找和替换')
    this.dom.hidden = true

    const row = () => {
      const el = document.createElement('div')
      el.className = 'search-row'
      return el
    }
    const firstRow = row()
    this.secondRow = row()

    const createInput = (name: string, placeholder: string) => {
      const el = document.createElement('input')
      el.name = name
      el.placeholder = placeholder
      el.setAttribute('aria-label', placeholder)
      el.className = 'search-input'
      el.oninput = () => this.handleInput()
      return el
    }

    this.searchInput = createInput('search', '查找')
    this.searchInput.setAttribute('main-field', 'true')
    this.replaceInput = createInput('replace', '替换')

    this.countLabel = document.createElement('span')
    this.countLabel.className = 'search-count'
    this.countLabel.setAttribute('aria-live', 'polite')

    const field = document.createElement('div')
    field.className = 'search-field'
    field.append(this.searchInput, this.countLabel)

    const createButton = (name: string, label: string, text: string, action: () => void) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.name = name
      el.title = label
      el.setAttribute('aria-label', label)
      el.textContent = text
      el.onclick = action
      return el
    }

    const createOption = (name: string, label: string, text: string) => {
      const wrapper = document.createElement('label')
      wrapper.className = 'search-option'
      wrapper.title = label
      const el = document.createElement('input')
      el.type = 'checkbox'
      el.name = name
      el.setAttribute('aria-label', label)
      el.onchange = () => this.handleInput()
      const caption = document.createElement('span')
      caption.textContent = text
      wrapper.append(el, caption)
      firstRow.append(wrapper)
      return el
    }

    firstRow.append(field)
    this.caseCheckbox = createOption('case', '区分大小写', 'Aa')
    this.wordCheckbox = createOption('word', '全词匹配', 'ab')
    this.regexCheckbox = createOption('re', '正则表达式', '.*')

    firstRow.append(
      createButton('prev', '上一个匹配 (Shift+Enter)', '↑', () => this.findPrevious()),
      createButton('next', '下一个匹配 (Enter)', '↓', () => this.findNext()),
      createButton('close', '关闭查找 (Esc)', '×', () => this.close())
    )

    this.secondRow.append(
      this.replaceInput,
      createButton('replace', '替换当前匹配', '替换', () => this.replaceCurrent()),
      createButton('replaceAll', '全部替换', '全部替换', () => this.replaceAll())
    )

    this.toggleButton = createButton('toggleReplace', '展开/收起替换', '›', () => {
      const willShow = this.secondRow.hidden
      this.setReplaceVisible(willShow)
      if (willShow) {
        this.replaceInput.focus()
        this.replaceInput.select()
      } else {
        this.searchInput.focus()
      }
    })
    this.secondRow.hidden = true
    this.toggleButton.setAttribute('aria-expanded', 'false')
    firstRow.prepend(this.toggleButton)

    this.dom.append(firstRow, this.secondRow)
    parent.append(this.dom)

    this.dom.onkeydown = event => {
      if (event.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        this.close()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        if (event.target === this.replaceInput && !event.shiftKey) {
          this.replaceCurrent()
        } else {
          event.shiftKey ? this.findPrevious() : this.findNext()
        }
      } else if (event.key === 'f' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        event.stopPropagation()
        this.open(false)
      } else if (event.key === 'r' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        event.stopPropagation()
        this.open(true)
      }
    }
  }

  get isOpen(): boolean {
    return !this.dom.hidden
  }

  private get pluginState(): LiveSearchState | undefined {
    return liveSearchPluginKey.getState(this.view.state)
  }

  setReplaceVisible(visible: boolean) {
    this.secondRow.hidden = !visible
    this.toggleButton.textContent = visible ? '⌄' : '›'
    this.toggleButton.setAttribute('aria-expanded', String(visible))
  }

  open(replace = false) {
    this.dom.hidden = false
    this.setReplaceVisible(replace)

    const sel = this.view.state.selection
    if (!sel.empty) {
      const selectedText = this.view.state.doc.textBetween(sel.from, sel.to)
      if (selectedText && selectedText.length <= 100 && !selectedText.includes('\n')) {
        this.searchInput.value = selectedText
      }
    }

    const tr = this.view.state.tr.setMeta(liveSearchPluginKey, {
      type: 'open',
      replace,
    })
    this.view.dispatch(tr)

    this.syncQueryToCodeBlocks()

    if (replace) {
      this.replaceInput.focus()
      this.replaceInput.select()
    } else {
      this.searchInput.focus()
      this.searchInput.select()
    }

    this.updateCount()
    this.revealCurrentMatch()
  }

  close() {
    this.dom.hidden = true
    const tr = this.view.state.tr.setMeta(liveSearchPluginKey, { type: 'close' })
    this.view.dispatch(tr)
    this.syncQueryToCodeBlocks()
    this.view.focus()
  }

  private handleInput() {
    const options: Partial<LiveSearchOptions> = {
      search: this.searchInput.value,
      replace: this.replaceInput.value,
      caseSensitive: this.caseCheckbox.checked,
      wholeWord: this.wordCheckbox.checked,
      regexp: this.regexCheckbox.checked,
    }

    const tr = this.view.state.tr.setMeta(liveSearchPluginKey, {
      type: 'setOptions',
      options,
    })
    this.view.dispatch(tr)

    this.syncQueryToCodeBlocks()

    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.syncTimer = setTimeout(() => {
      this.syncTimer = undefined
      this.updateCount()
      this.revealCurrentMatch()
    }, 60)
  }

  private syncQueryToCodeBlocks() {
    const query = this.isOpen ? this.searchInput.value : ''
    const caseSensitive = this.caseCheckbox.checked
    const wholeWord = this.wordCheckbox.checked
    const regexp = this.regexCheckbox.checked

    for (const codeView of this.codeViewsGetter()) {
      codeView.setSearchHighlight?.(query, caseSensitive, wholeWord, regexp)
    }
  }

  updateCount() {
    const state = this.pluginState
    if (!state || !state.active || !this.searchInput.value) {
      this.countLabel.textContent = ''
      this.searchInput.removeAttribute('aria-invalid')
      return
    }

    if (!state.valid) {
      this.countLabel.textContent = '无效正则'
      this.searchInput.setAttribute('aria-invalid', 'true')
      return
    }

    this.searchInput.removeAttribute('aria-invalid')
    const total = state.matches.length
    if (total === 0) {
      this.countLabel.textContent = '0 处'
    } else {
      const current = state.currentIndex >= 0 ? state.currentIndex + 1 : 1
      this.countLabel.textContent = total >= 1500 ? '1500+ 处' : `${current} / ${total}`
    }
  }

  findNext() {
    const state = this.pluginState
    if (!state || !state.matches.length) return
    const nextIndex = (state.currentIndex + 1) % state.matches.length
    this.setCurrentIndex(nextIndex)
  }

  findPrevious() {
    const state = this.pluginState
    if (!state || !state.matches.length) return
    const prevIndex = (state.currentIndex - 1 + state.matches.length) % state.matches.length
    this.setCurrentIndex(prevIndex)
  }

  private setCurrentIndex(index: number) {
    const tr = this.view.state.tr.setMeta(liveSearchPluginKey, {
      type: 'setCurrentIndex',
      index,
    })
    this.view.dispatch(tr)
    this.updateCount()
    this.revealCurrentMatch()
  }

  private revealCurrentMatch() {
    const state = this.pluginState
    if (!state || state.currentIndex < 0 || state.currentIndex >= state.matches.length) return
    const match = state.matches[state.currentIndex]

    if (match.codeBlockPos !== undefined) {
      // Inside an embedded code block
      for (const codeView of this.codeViewsGetter()) {
        const pos = codeView.getPos?.()
        if (pos === match.codeBlockPos) {
          const from = match.from - pos - 1
          const to = match.to - pos - 1
          codeView.setSelection(from, to)
          codeView.dom.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
          return
        }
      }
    }

    // Regular prose or heading
    if (match.from >= 0 && match.to <= this.view.state.doc.content.size) {
      const sel = TextSelection.create(this.view.state.doc, match.from, match.to)
      const tr = this.view.state.tr.setSelection(sel).scrollIntoView()
      this.view.dispatch(tr)
    }
  }

  replaceCurrent() {
    const state = this.pluginState
    if (!state || !state.valid || state.currentIndex < 0 || state.currentIndex >= state.matches.length) return
    const match = state.matches[state.currentIndex]

    let insert = this.replaceInput.value
    if (state.options.regexp) {
      try {
        const regex = new RegExp(
          state.options.search,
          state.options.caseSensitive ? 'u' : 'iu'
        )
        insert = match.text.replace(regex, insert)
      } catch {
        // Fallback to literal insert
      }
    }

    const tr = this.view.state.tr
    if (insert.length) {
      tr.insertText(insert, match.from, match.to)
    } else {
      tr.delete(match.from, match.to)
    }
    tr.setMeta('isolated', true)
    this.view.dispatch(tr)

    // After replace, plugin apply recomputes matches
    setTimeout(() => {
      this.updateCount()
      this.revealCurrentMatch()
    }, 20)
  }

  replaceAll() {
    const state = this.pluginState
    if (!state || !state.valid || !state.matches.length) return

    const replacePattern = this.replaceInput.value
    const isRegex = state.options.regexp
    const caseSensitive = state.options.caseSensitive

    let regex: RegExp | null = null
    if (isRegex) {
      try {
        regex = new RegExp(state.options.search, caseSensitive ? 'u' : 'iu')
      } catch {
        regex = null
      }
    }

    const tr = this.view.state.tr
    // Replace backwards to keep earlier match positions intact
    for (let i = state.matches.length - 1; i >= 0; i--) {
      const m = state.matches[i]
      let insert = replacePattern
      if (regex) {
        insert = m.text.replace(regex, replacePattern)
      }
      if (insert.length) {
        tr.insertText(insert, m.from, m.to)
      } else {
        tr.delete(m.from, m.to)
      }
    }

    tr.setMeta('isolated', true)
    this.view.dispatch(tr)

    setTimeout(() => {
      this.updateCount()
      this.syncQueryToCodeBlocks()
    }, 20)
  }

  destroy() {
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.dom.remove()
  }
}
