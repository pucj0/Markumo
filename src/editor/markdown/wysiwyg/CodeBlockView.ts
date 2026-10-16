import { EditorState as CMState, Compartment, Prec, StateEffect, StateField } from '@codemirror/state'
import { EditorView as CMView, keymap, lineNumbers, Decoration, WidgetType, type DecorationSet } from '@codemirror/view'
import { defaultKeymap, indentWithTab, indentLess } from '@codemirror/commands'
import { lightEditSyntax } from '../../core/syntaxTheme'
import { LanguageSelector } from './LanguageSelector'
import { copyStatusIcon } from '../../../components/common/iconPaths'
import type { Node } from 'prosemirror-model'
import { TextSelection, Selection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { parseFenceInfo, loadLanguage } from '../../languages'
import { textClipboard } from '../../../features/shell/clipboard'
import type { MarkdownTypography } from './contracts'

interface CodeSearchRange { from: number; to: number; current: boolean }
const setCodeSearch = StateEffect.define<CodeSearchRange[]>()
class ZeroSearchMatch extends WidgetType {
  constructor(private current: boolean) { super() }
  eq(other: ZeroSearchMatch) { return this.current === other.current }
  toDOM() {
    const marker = document.createElement('span')
    marker.className = `cm-searchMatch md-search-zero md-search-match${this.current ? ' cm-searchMatch-selected md-search-match-current' : ''}`
    marker.setAttribute('aria-hidden', 'true')
    return marker
  }
}
const codeSearchDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const effect of tr.effects) if (effect.is(setCodeSearch)) {
      value = Decoration.set(effect.value.filter(r => r.from <= r.to && r.to <= tr.newDoc.length).map(r => r.from === r.to
        ? Decoration.widget({ widget: new ZeroSearchMatch(r.current), side: 1 }).range(r.from)
        : Decoration.mark({ class: `cm-searchMatch md-search-match${r.current ? ' cm-searchMatch-selected md-search-match-current' : ''}` }).range(r.from, r.to)), true)
    }
    return value
  },
  provide: field => CMView.decorations.from(field),
})

export class CodeBlockView implements NodeView {
  readonly dom = document.createElement('div')
  readonly surface = document.createElement('div')
  readonly cm: CMView
  private language = new Compartment()
  private numbers = new Compartment()
  private wrap = new Compartment()
  private updating = false
  private dead = false
  private generation = 0
  private highlightKey = ''
  private highlightDoc?: CMState['doc']
  private pendingHighlights: CodeSearchRange[] = []
  private highlightScheduled = false

  private selector: LanguageSelector
  private languageStatus = document.createElement('span')
  private copyTimer: ReturnType<typeof setTimeout> | undefined
  private diagram = document.createElement('div')
  private diagramToolbar = document.createElement('div')
  private renderButton = document.createElement('button')
  private editSourceButton = document.createElement('button')
  private copyButton = document.createElement('button')
  private cmContainer = document.createElement('div')
  private isMermaid = false
  private isEditingMermaid = false
  private renderGeneration = 0
  private themeObserver?: MutationObserver
  private renderTimer?: ReturnType<typeof setTimeout>

  constructor(
    private node: Node,
    private outer: EditorView,
    readonly getPos: () => number | undefined,
    settings: MarkdownTypography,
    private history: (forward: boolean) => void,
    private onSearchRequest?: (replace: boolean) => void,
    private onSearchNavigate?: (forward: boolean) => void
  ) {
    this.isMermaid = /^mermaid(?:\s|$)/i.test(node.attrs.params)
    this.dom.className = 'md-code-block md-code-block-container'
    this.dom.contentEditable = 'false'
    this.surface.className = 'md-code-surface'

    // Copy button (top-right of surface, hover display)
    this.copyButton.type = 'button'
    this.copyButton.className = 'md-code-copy'
    this.copyButton.setAttribute('aria-label', '复制代码')
    this.copyButton.title = '复制代码'
    this.copyButton.append(copyStatusIcon())
    this.copyButton.onclick = () => {
      void textClipboard.writeText(this.cm.state.doc.toString()).then(() => {
        if (this.dead) return
        this.copyButton.replaceChildren(copyStatusIcon(true))
        this.copyButton.title = '已复制'
        if (this.copyTimer) clearTimeout(this.copyTimer)
        this.copyTimer = setTimeout(() => {
          if (!this.dead) { this.copyButton.replaceChildren(copyStatusIcon()); this.copyButton.title = '复制代码' }
        }, 1500)
      }).catch(error => window.dispatchEvent(new CustomEvent('editor-notice', { detail: String(error) })))
    }

    this.selector = new LanguageSelector(node.attrs.params, params => {
      const pos = this.getPos()
      if (this.dead || pos === undefined || this.outer.state.doc.nodeAt(pos) !== this.node || this.cm.compositionStarted) return
      const unchanged = params === this.node.attrs.params
      this.outer.dispatch(this.outer.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, params }).setMeta('isolated', true))
      if (!this.dead && unchanged) this.setLanguage()
    })
    this.languageStatus.className = 'md-code-language-status'
    this.languageStatus.setAttribute('role', 'status')
    this.selector.dock.prepend(this.languageStatus)

    // Mermaid specific controls
    this.diagram.className = 'md-diagram'
    this.diagramToolbar.className = 'md-diagram-toolbar'

    this.renderButton.type = 'button'
    this.renderButton.className = 'md-diagram-btn'
    this.renderButton.textContent = '渲染 Mermaid'
    this.renderButton.onclick = () => this.setMermaidEditing(false)

    this.editSourceButton.type = 'button'
    this.editSourceButton.className = 'md-diagram-btn'
    this.editSourceButton.textContent = '编辑图表源码'
    this.editSourceButton.onclick = () => {
      this.setMermaidEditing(!this.isEditingMermaid)
    }

    this.diagramToolbar.append(this.editSourceButton, this.renderButton)
    this.diagramToolbar.hidden = !this.isMermaid
    this.diagram.hidden = !this.isMermaid

    // CodeMirror Container
    this.cmContainer.className = 'md-code-editor-wrap'

    this.surface.append(this.diagramToolbar, this.cmContainer, this.diagram, this.copyButton, this.selector.row)
    this.dom.append(this.surface)

    this.dom.addEventListener('focusin', () => this.updateFocusState())
    this.dom.addEventListener('focusout', () => queueMicrotask(() => {
      this.updateFocusState()
      if (!this.dead && this.isEditingMermaid && !this.cm.compositionStarted && !this.dom.contains(document.activeElement)) this.setMermaidEditing(false)
    }))

    // Build embedded CodeMirror
    this.cm = new CMView({
      parent: this.cmContainer,
      state: CMState.create({
        doc: node.textContent,
        extensions: [
          this.language.of([]),
          this.numbers.of(settings.codeLineNumbers ? lineNumbers() : []),
          this.wrap.of(settings.codeWrap ? CMView.lineWrapping : []),
          lightEditSyntax,
          codeSearchDecorations,
          CMView.contentAttributes.of({ 'aria-label': '代码块编辑器' }),
          Prec.highest(
            keymap.of([
              { key: 'Mod-z', run: () => { this.history(false); return true } },
              { key: 'Mod-y', run: () => { this.history(true); return true } },
              { key: 'Mod-Shift-z', run: () => { this.history(true); return true } },
              {
                key: 'Mod-f',
                run: () => {
                  this.onSearchRequest?.(false)
                  return true
                },
              },
              {
                key: 'Mod-r',
                run: () => {
                  this.onSearchRequest?.(true)
                  return true
                },
              },
              { key: 'F3', run: () => { this.onSearchNavigate?.(true); return true } },
              { key: 'Shift-F3', run: () => { this.onSearchNavigate?.(false); return true } },
              indentWithTab,
              { key: 'Shift-Tab', run: indentLess },
              { key: 'ArrowUp', run: () => this.escape(-1) },
              { key: 'ArrowDown', run: () => this.escape(1) },
              { key: 'ArrowLeft', run: () => this.escape(-1, true) },
              { key: 'ArrowRight', run: () => this.escape(1, true) },
              { key: 'Mod-Enter', run: () => this.insertParagraph(1) },
              { key: 'Mod-Shift-Enter', run: () => this.insertParagraph(-1) },
              {
                key: 'Backspace',
                run: () => {
                  if (this.cm.state.doc.length) return false
                  const pos = this.getPos()
                  if (pos === undefined) return false
                  this.outer.dispatch(
                    this.outer.state.tr.setNodeMarkup(pos, this.outer.state.schema.nodes.paragraph)
                  )
                  this.outer.focus()
                  return true
                },
              },
            ])
          ),
          keymap.of(defaultKeymap),
          CMView.updateListener.of(update => {
            if (this.updating) return
            const pos = this.getPos()
            if (pos === undefined) return
            if (update.docChanged) {
              const tr = this.outer.state.tr
              let delta = 0
              update.changes.iterChanges((from, to, _a, _b, insert) => {
                tr.replaceWith(
                  pos + 1 + from + delta,
                  pos + 1 + to + delta,
                  insert.length ? this.outer.state.schema.text(insert.toString()) : []
                )
                delta += insert.length - (to - from)
              })
              const sel = update.state.selection.main
              tr.setSelection(TextSelection.create(tr.doc, pos + 1 + sel.anchor, pos + 1 + sel.head))
              this.outer.dispatch(tr)
            } else if (update.selectionSet || (update.focusChanged && update.view.hasFocus)) {
              if (update.focusChanged) {
                this.updateFocusState()
              }
              const sel = update.state.selection.main
              this.outer.dispatch(
                this.outer.state.tr.setSelection(
                  TextSelection.create(this.outer.state.doc, pos + 1 + sel.anchor, pos + 1 + sel.head)
                )
              )
            } else if (update.focusChanged) {
              this.updateFocusState()
            }
          }),
        ],
      }),
    })

    this.setLanguage()

    if (this.isMermaid) {
      this.setMermaidEditing(false)
    }
  }

  private updateFocusState() {
    if (this.dead) return
    const isFocused = this.cm.hasFocus || this.selector.isInteracting || this.dom.contains(document.activeElement)
    this.dom.classList.toggle('is-focused', isFocused)
  }

  private setMermaidEditing(editing: boolean) {
    if (this.isMermaid && !this.themeObserver) {
      let light = document.body.classList.contains('light')
      this.themeObserver = new MutationObserver(() => {
        const next = document.body.classList.contains('light')
        if (light === next) return
        light = next
        void this.renderMermaidDiagram()
      })
      this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    } else if (!this.isMermaid) {
      this.themeObserver?.disconnect()
      this.themeObserver = undefined
    }
    this.isEditingMermaid = editing
    this.copyButton.hidden = this.isMermaid && !editing
    this.cmContainer.hidden = this.isMermaid && !editing
    this.diagram.hidden = !this.isMermaid
    this.renderButton.hidden = !editing
    this.editSourceButton.textContent = editing ? '完成编辑' : '编辑图表源码'
    if (editing) this.cm.focus()
    if (this.isMermaid) void this.renderMermaidDiagram()
  }

  private async renderMermaidDiagram() {
    const generation = ++this.renderGeneration
    this.renderButton.disabled = true
    if (!this.diagram.querySelector('svg')) this.diagram.textContent = '图表加载中…'
    try {
      const { renderDiagram } = await import('./renderers')
      await renderDiagram(this.diagram, this.node.textContent, () => !this.dead && generation === this.renderGeneration && this.isMermaid)
    } catch (error) {
      if (!this.dead && generation === this.renderGeneration) this.diagram.textContent = `图表无法渲染：${String(error)}`
    } finally {
      if (!this.dead && generation === this.renderGeneration) {
        this.renderButton.disabled = false
        this.cm.requestMeasure()
      }
    }
  }

  setSearchHighlights(ranges: CodeSearchRange[]) {
    this.pendingHighlights = ranges
    if (this.highlightScheduled) return
    this.highlightScheduled = true
    // A PM update can originate in the embedded CM's update listener. Apply
    // decorations after that update completes, never dispatch re-entrantly.
    queueMicrotask(() => {
      this.highlightScheduled = false
      if (this.dead) return
      const key = JSON.stringify(this.pendingHighlights)
      if (key === this.highlightKey && this.highlightDoc === this.cm.state.doc) return
      this.highlightKey = key; this.highlightDoc = this.cm.state.doc
      this.cm.dispatch({ effects: setCodeSearch.of(this.pendingHighlights) })
    })
  }

  private setLanguage() {
    const generation = ++this.generation
    const { label, language } = parseFenceInfo(this.node.attrs.params)
    this.cm.dispatch({ effects: this.language.reconfigure([]) })
    this.languageStatus.textContent = label && !language && !this.isMermaid ? '未注册语言 · 纯文本' : ''
    this.dom.dataset.languageStatus = language ? 'loading' : 'plain'
    if (!language) return
    void loadLanguage(language.name,'fence').then(extension => {
      if (!this.dead && generation === this.generation) {
        this.cm.dispatch({ effects: this.language.reconfigure(extension) })
        this.dom.dataset.languageStatus = 'ready'
      }
    }).catch(() => {
      if (!this.dead && generation === this.generation) {
        this.languageStatus.textContent = '语言加载失败 · 纯文本（重新选择可重试）'
        this.dom.dataset.languageStatus = 'error'
      }
    })
  }

  private escape(direction: number, horizontal = false) {
    const { state } = this.cm
    const sel = state.selection.main
    if (!sel.empty) return false
    if (
      direction < 0
        ? horizontal
          ? sel.head !== 0
          : state.doc.lineAt(sel.head).number !== 1
        : horizontal
        ? sel.head !== state.doc.length
        : state.doc.lineAt(sel.head).number !== state.doc.lines
    )
      return false
    const pos = this.getPos()
    if (pos === undefined) return false
    const target = direction < 0 ? pos : pos + this.node.nodeSize
    this.outer.dispatch(
      this.outer.state.tr
        .setSelection(Selection.near(this.outer.state.doc.resolve(target), direction))
        .scrollIntoView()
    )
    this.outer.focus()
    return true
  }

  private insertParagraph(direction: number) {
    const pos = this.getPos()
    if (pos === undefined) return false
    const at = direction < 0 ? pos : pos + this.node.nodeSize
    const tr = this.outer.state.tr.insert(at, this.outer.state.schema.nodes.paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, at + 1))
    this.outer.dispatch(tr.scrollIntoView())
    this.outer.focus()
    return true
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false
    const changed = node.textContent !== this.node.textContent
    const languageChanged = node.attrs.params !== this.node.attrs.params
    this.node = node
    this.selector.update(node.attrs.params)

    const wasMermaid = this.isMermaid
    this.isMermaid = /^mermaid(?:\s|$)/i.test(node.attrs.params)
    this.diagramToolbar.hidden = !this.isMermaid
    if (wasMermaid !== this.isMermaid) this.setMermaidEditing(false)

    const current = this.cm.state.doc.toString()
    const next = node.textContent

    if (changed && wasMermaid === this.isMermaid && this.isMermaid) {
      // Invalidate an older in-flight result immediately, then debounce typing.
      this.renderGeneration++
      if (this.renderTimer) clearTimeout(this.renderTimer)
      this.renderTimer = setTimeout(() => { if (!this.dead) void this.renderMermaidDiagram() }, 120)
    }

    if (current !== next) {
      let from = 0
      let end = current.length
      let to = next.length
      while (from < end && from < to && current[from] === next[from]) from++
      while (end > from && to > from && current[end - 1] === next[to - 1]) {
        end--
        to--
      }
      this.updating = true
      try {
        this.cm.dispatch({ changes: { from, to: end, insert: next.slice(from, to) } })
      } finally {
        this.updating = false
      }
    }

    if (languageChanged) this.setLanguage()
    return true
  }

  setSelection(anchor: number, head: number) {
    this.updating = true
    try {
      if (this.cmContainer.hidden) {
        // Selection/search navigation must not turn a rendered diagram into source.
        this.dom.scrollIntoView({ block: 'nearest' })
        return
      }
      this.cm.dispatch({ selection: { anchor, head } })
      this.cm.focus()
    } finally {
      this.updating = false
    }
  }

  typography(settings: MarkdownTypography) {
    this.cm.dispatch({
      effects: [
        this.numbers.reconfigure(settings.codeLineNumbers ? lineNumbers() : []),
        this.wrap.reconfigure(settings.codeWrap ? CMView.lineWrapping : []),
      ],
    })
  }

  stopEvent() {
    return true
  }

  ignoreMutation() {
    return true
  }

  destroy() {
    if (this.renderTimer) clearTimeout(this.renderTimer)
    this.dead = true
    this.themeObserver?.disconnect()
    this.generation++
    this.cm.destroy()
    this.selector.destroy()
    if (this.copyTimer) clearTimeout(this.copyTimer)
  }
}
