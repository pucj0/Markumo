import { type EditorView, type Panel, type ViewUpdate, runScopeHandlers } from '@codemirror/view'
import { SearchQuery, getSearchQuery, setSearchQuery, findNext, findPrevious, selectMatches, replaceNext, replaceAll, openSearchPanel, closeSearchPanel } from '@codemirror/search'

export function showEditorSearch(view: EditorView, replacement: boolean) {
  if (view.compositionStarted) return true
  openSearchPanel(view)
  const field = view.dom.querySelector<HTMLInputElement>('.cm-search input[name="replace"]')
  if (field?.parentElement) field.parentElement.hidden = !replacement
  const toggle = view.dom.querySelector('.cm-search button[name="toggleReplace"]')
  if (toggle) { toggle.setAttribute('aria-expanded', String(replacement)); toggle.textContent = replacement ? '⌄' : '›' }
  view.dom.querySelector<HTMLInputElement>(`.cm-search input[name="${replacement ? 'replace' : 'search'}"]`)?.focus()
  view.requestMeasure()
  return true
}

export function createEditorSearchPanel(view: EditorView): Panel {
  const dom = document.createElement('div'); dom.className = 'cm-search fleet-search'
  dom.setAttribute('role', 'search'); dom.setAttribute('aria-label', '文档查找和替换')
  const row = () => { const el = document.createElement('div'); el.className = 'search-row'; return el }
  const first = row(), second = row()
  const input = (name: string, label: string) => {
    const el = document.createElement('input'); el.name = name; el.placeholder = label; el.setAttribute('aria-label', label)
    el.className = 'search-input'; el.oninput = commit; return el
  }
  const search = input('search', '查找'), replace = input('replace', '替换')
  search.setAttribute('main-field', 'true')
  const count = document.createElement('span'); count.className = 'search-count'; count.setAttribute('aria-live', 'polite')
  const field = document.createElement('div'); field.className = 'search-field'; field.append(search, count)
  const button = (name: string, label: string, text: string, action: () => void) => {
    const el = document.createElement('button'); el.type = 'button'; el.name = name; el.title = label
    el.setAttribute('aria-label', label); el.textContent = text; el.onclick = action; return el
  }
  const option = (name: string, label: string, text: string) => {
    const wrapper = document.createElement('label'); wrapper.className = 'search-option'; wrapper.title = label
    const el = document.createElement('input'); el.type = 'checkbox'; el.name = name; el.setAttribute('aria-label', label); el.onchange = commit
    const caption = document.createElement('span'); caption.textContent = text; wrapper.append(el, caption); first.append(wrapper); return el
  }
  first.append(field)
  const caseSensitive = option('case', '区分大小写', 'Aa'), wholeWord = option('word', '全词匹配', 'ab'), regexp = option('re', '正则表达式', '.*')
  first.append(button('prev', '上一个匹配 (Shift+Enter)', '↑', () => { findPrevious(view) }),
    button('next', '下一个匹配 (Enter)', '↓', () => { findNext(view) }),
    button('select', '选择全部匹配', '全选', () => { selectMatches(view) }),
    button('close', '关闭查找 (Esc)', '×', () => { closeSearchPanel(view) }))
  second.append(replace, button('replace', '替换当前匹配', '替换', () => { replaceNext(view) }), button('replaceAll', '全部替换', '全部替换', () => { replaceAll(view) }))
  const toggle = button('toggleReplace', '展开/收起替换', '›', () => {
    second.hidden = !second.hidden; toggle.textContent = second.hidden ? '›' : '⌄'
    toggle.setAttribute('aria-expanded', String(!second.hidden))
    view.requestMeasure()
  })
  second.hidden = true
  toggle.setAttribute('aria-expanded', 'false'); first.prepend(toggle)
  dom.append(first, second)
  let timer: ReturnType<typeof setTimeout> | undefined
  function commit() {
    const current = getSearchQuery(view.state)
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: search.value, replace: replace.value,
      caseSensitive: caseSensitive.checked, wholeWord: wholeWord.checked, regexp: regexp.checked, literal: current.literal })) })
  }
  function sync() {
    const query = getSearchQuery(view.state)
    if (search.value !== query.search) search.value = query.search
    if (replace.value !== query.replace) replace.value = query.replace
    caseSensitive.checked = query.caseSensitive; wholeWord.checked = query.wholeWord; regexp.checked = query.regexp
    search.setAttribute('aria-invalid', String(!!query.search && !query.valid))
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      if (!query.search) { count.textContent = ''; return }
      if (!query.valid) { count.textContent = '无效正则'; return }
      if (view.state.doc.length > 1024 * 1024) { count.textContent = '匹配高亮'; return }
      const cursor = query.getCursor(view.state); let total = 0, current = 0
      for (let item = cursor.next(); !item.done; item = cursor.next()) {
        total++; if (item.value.from === view.state.selection.main.from && item.value.to === view.state.selection.main.to) current = total
        if (total > 1000) break
      }
      count.textContent = total > 1000 ? '1000+ 处' : current ? `${current} / ${total}` : `${total} 处`
    }, 80)
  }
  dom.onkeydown = event => {
    if (event.isComposing) return
    if (event.key === 'Escape') { closeSearchPanel(view); event.preventDefault(); event.stopPropagation() }
    else if (event.key === 'Enter') { event.shiftKey ? findPrevious(view) : findNext(view); event.preventDefault(); event.stopPropagation() }
    else if (runScopeHandlers(view, event, 'search-panel')) { event.preventDefault(); event.stopPropagation() }
  }
  sync()
  return { dom, top: true, mount() { search.focus(); search.select() }, update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.transactions.some(tr => tr.effects.some(effect => effect.is(setSearchQuery)))) sync()
  }, destroy() { if (timer) clearTimeout(timer) } }
}
