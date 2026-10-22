import { EditorState as CMState, Compartment, Prec, StateEffect, StateField } from '@codemirror/state'
import { EditorView as CMView, drawSelection, keymap, lineNumbers, Decoration, WidgetType, type DecorationSet } from '@codemirror/view'
import { smoothCaret } from '../../core/smoothCaret'
import type { CaretAnimation } from '../../core/caretMotion'
import { defaultKeymap, indentWithTab, indentLess } from '@codemirror/commands'
import { bracketHighlight, type BracketMode } from '../../core/brackets'
import { markumoSyntax } from '../../core/syntaxTheme'
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

/**
 * Lightweight CodeBlockView with Viewport Boundary Virtualization + Focus Retention.
 * Out-of-viewport unedited code blocks stay in a light placeholder state, saving
 * 90%+ DOM nodes and memory while keeping instant, jank-free native CM6 when viewed/focused.
 */
export class CodeBlockView implements NodeView {
  readonly dom = document.createElement('div')
  readonly surface = document.createElement('div')
  private cmInstance: CMView | null = null

  private language = new Compartment()
  private numbers = new Compartment()
  private wrap = new Compartment()
  private caret = new Compartment()
  private brackets = new Compartment()
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
  private placeholder: HTMLElement | null = null
  private isMermaid = false
  private isEditingMermaid = false
  private renderGeneration = 0
  private themeObserver?: MutationObserver
  private renderTimer?: ReturnType<typeof setTimeout>
  private observer?: IntersectionObserver
  private inViewport = false
  private isFocused = false

  constructor(
    private node: Node,
    private outer: EditorView,
    readonly getPos: () => number | undefined,
    private settings: MarkdownTypography,
    private history: (forward: boolean) => void,
    private onSearchRequest?: (replace: boolean) => void,
    private onSearchNavigate?: (forward: boolean) => void,
    private caretAnim: CaretAnimation = 'smooth',
    private bracketMod: BracketMode = 'matching'
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
      const codeText = this.cmInstance ? this.cmInstance.state.doc.toString() : this.node.textContent
      void textClipboard.writeText(codeText).then(() => {
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
      if (this.dead || pos === undefined || this.outer.state.doc.nodeAt(pos) !== this.node || this.cmInstance?.compositionStarted) return
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

    this.surface.append(this.diagramToolbar, this.cmContainer, this.diagram, this.copyButton)
    this.dom.append(this.surface, this.selector.row)

    this.dom.addEventListener('focusin', () => {
      this.isFocused = true
      this.ensureEditor()
      this.updateFocusState()
    })
    this.dom.addEventListener('focusout', () => queueMicrotask(() => {
      this.isFocused = !!this.dom.contains(document.activeElement)
      this.updateFocusState()
      if (!this.dead && this.isEditingMermaid && !this.cmInstance?.compositionStarted && !this.isFocused) {
        this.setMermaidEditing(false)
      }
      if (!this.inViewport && !this.isFocused) {
        this.detachEditor()
      }
    }))

    // Pre-activate on pointer interaction to guarantee seamless cursor positioning
    this.dom.addEventListener('pointerdown', () => {
      this.ensureEditor()
    }, { capture: true })

    // Viewport-based mount observer: ±600px buffer zone
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(entries => {
        if (this.dead) return
        for (const entry of entries) {
          if (entry.target === this.dom) {
            this.inViewport = entry.isIntersecting
            if (this.inViewport) {
              this.ensureEditor()
            } else if (!this.isFocused && !this.isEditingMermaid) {
              this.detachEditor()
            }
          }
        }
      }, {
        root: null,
        rootMargin: '600px 0px 600px 0px'
      })
      this.observer.observe(this.dom)
    } else {
      this.inViewport = true
    }

    if (this.isMermaid) {
      this.setMermaidEditing(false)
    } else {
      // Default: ensure editor if initially visible or near viewport
      this.ensureEditor()
    }
  }

  get cm(): CMView {
    return this.ensureEditor()
  }

  ensureEditor(): CMView {
    if (this.cmInstance) {
      return this.cmInstance
    }
    if (this.placeholder) {
      this.placeholder.remove()
      this.placeholder = null
    }

    this.cmContainer.style.minHeight = ''
    this.cmInstance = new CMView({
      parent: this.cmContainer,
      state: CMState.create({
        doc: this.node.textContent,
        extensions: [
          this.caret.of([smoothCaret(this.caretAnim), this.caretAnim === 'off' ? [] : drawSelection()]),
          this.language.of([]),
          this.numbers.of(this.settings.codeLineNumbers ? lineNumbers() : []),
          this.wrap.of(this.settings.codeWrap ? CMView.lineWrapping : []),
          markumoSyntax,
          this.brackets.of(bracketHighlight(this.bracketMod)),
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
                  if (this.cmInstance && this.cmInstance.state.doc.length) return false
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
    if (this.pendingHighlights.length) {
      this.cmInstance.dispatch({ effects: setCodeSearch.of(this.pendingHighlights) })
    }
    return this.cmInstance
  }

  private detachEditor() {
    if (!this.cmInstance || this.dead) return
    // Never detach if focused or in IME composition
    if (this.isFocused || this.cmInstance.hasFocus || this.cmInstance.compositionStarted || this.dom.contains(document.activeElement)) {
      return
    }

    const currentHeight = this.cmContainer.offsetHeight
    if (currentHeight > 0) {
      this.cmContainer.style.minHeight = `${currentHeight}px`
    }

    this.cmInstance.destroy()
    this.cmInstance = null

    // Render lightweight static placeholder
    if (!this.placeholder && !this.isMermaid) {
      this.placeholder = document.createElement('pre')
      this.placeholder.className = 'md-code-placeholder'
      const code = document.createElement('code')
      code.textContent = this.node.textContent
      this.placeholder.appendChild(code)
      this.cmContainer.appendChild(this.placeholder)
    }
  }

  private updateFocusState() {
    if (this.dead) return
    const isFocused = (this.cmInstance && this.cmInstance.hasFocus) || this.selector.isInteracting || this.dom.contains(document.activeElement)
    this.dom.classList.toggle('is-focused', isFocused)
  }

  setMermaidEditing(editing: boolean) {
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

    if (editing) {
      this.ensureEditor().focus()
    } else {
      // Free heavy editor instance when displaying rendered Mermaid diagram
      if (this.cmInstance && !this.isFocused) {
        this.cmInstance.destroy()
        this.cmInstance = null
      }
    }
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
        this.cmInstance?.requestMeasure()
      }
    }
  }

  setSearchHighlights(ranges: CodeSearchRange[]) {
    this.pendingHighlights = ranges
    if (this.highlightScheduled) return
    this.highlightScheduled = true
    queueMicrotask(() => {
      this.highlightScheduled = false
      if (this.dead) return
      if (!this.cmInstance) {
        if (ranges.length > 0) {
          this.ensureEditor()
        } else {
          return
        }
      }
      const key = JSON.stringify(this.pendingHighlights)
      if (key === this.highlightKey && this.highlightDoc === this.cmInstance?.state.doc) return
      if (this.cmInstance) {
        this.highlightKey = key
        this.highlightDoc = this.cmInstance.state.doc
        this.cmInstance.dispatch({ effects: setCodeSearch.of(this.pendingHighlights) })
      }
    })
  }

  private setLanguage() {
    if (!this.cmInstance) return
    const generation = ++this.generation
    const { label, language } = parseFenceInfo(this.node.attrs.params)
    this.cmInstance.dispatch({ effects: this.language.reconfigure([]) })
    this.languageStatus.textContent = label && !language && !this.isMermaid ? '未注册语言 · 纯文本' : ''
    this.dom.dataset.languageStatus = language ? 'loading' : 'plain'
    if (!language) return
    void loadLanguage(language.name, 'fence').then(extension => {
      if (!this.dead && generation === this.generation && this.cmInstance) {
        this.cmInstance.dispatch({ effects: this.language.reconfigure(extension) })
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
    if (!this.cmInstance) return false
    const { state } = this.cmInstance
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

    if (this.cmInstance) {
      const current = this.cmInstance.state.doc.toString()
      const next = node.textContent

      if (changed && wasMermaid === this.isMermaid && this.isMermaid) {
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
          this.cmInstance.dispatch({ changes: { from, to: end, insert: next.slice(from, to) } })
        } finally {
          this.updating = false
        }
      }

      if (languageChanged) this.setLanguage()
    } else {
      if (this.placeholder && changed) {
        const code = this.placeholder.querySelector('code')
        if (code) code.textContent = node.textContent
      }
    }
    return true
  }

  setSelection(anchor: number, head: number) {
    const editor = this.ensureEditor()
    this.updating = true
    try {
      if (this.cmContainer.hidden) {
        this.dom.scrollIntoView({ block: 'nearest' })
        return
      }
      editor.dispatch({ selection: { anchor, head } })
      editor.focus()
    } finally {
      this.updating = false
    }
  }

  typography(settings: MarkdownTypography) {
    this.settings = settings
    if (this.cmInstance) {
      this.cmInstance.dispatch({
        effects: [
          this.numbers.reconfigure(settings.codeLineNumbers ? lineNumbers() : []),
          this.wrap.reconfigure(settings.codeWrap ? CMView.lineWrapping : []),
        ],
      })
    }
  }

  bracketMode(mode: BracketMode) {
    this.bracketMod = mode
    if (this.cmInstance) {
      this.cmInstance.dispatch({ effects: this.brackets.reconfigure(bracketHighlight(mode)) })
    }
  }

  caretAnimation(mode: CaretAnimation) {
    this.caretAnim = mode
    if (this.cmInstance) {
      this.cmInstance.dispatch({ effects: this.caret.reconfigure([smoothCaret(mode), mode === 'off' ? [] : drawSelection()]) })
    }
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
    this.observer?.disconnect()
    this.observer = undefined
    this.themeObserver?.disconnect()
    this.themeObserver = undefined
    this.generation++
    this.cmInstance?.destroy()
    this.cmInstance = null
    this.selector.destroy()
    if (this.copyTimer) clearTimeout(this.copyTimer)
  }
}
