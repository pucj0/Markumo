import { EditorState as CMState, Compartment, Prec } from '@codemirror/state'
import { EditorView as CMView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, indentWithTab, indentLess } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { search, setSearchQuery, SearchQuery } from '@codemirror/search'
import type { Node } from 'prosemirror-model'
import { TextSelection, Selection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { detectLanguage, languageNames, loadLanguage, type LanguageName } from '../../languages'
import { textClipboard } from '../../../features/shell/clipboard'
import type { MarkdownTypography } from './contracts'

export class CodeBlockView implements NodeView {
  readonly dom = document.createElement('div')
  readonly cm: CMView
  private language = new Compartment()
  private numbers = new Compartment()
  private wrap = new Compartment()
  private updating = false
  private dead = false
  private generation = 0

  private select = document.createElement('input')
  private diagram = document.createElement('div')
  private diagramToolbar = document.createElement('div')
  private renderButton = document.createElement('button')
  private editSourceButton = document.createElement('button')
  private copyButton = document.createElement('button')
  private cmContainer = document.createElement('div')
  private isMermaid = false
  private isEditingMermaid = false

  constructor(
    private node: Node,
    private outer: EditorView,
    readonly getPos: () => number | undefined,
    settings: MarkdownTypography,
    private history: (forward: boolean) => void,
    private onSearchRequest?: (replace: boolean) => void
  ) {
    this.isMermaid = /^mermaid(?:\s|$)/i.test(node.attrs.params)
    this.dom.className = 'md-code-block'
    this.dom.contentEditable = 'false'

    // Copy button (top-right, hover/focus display)
    this.copyButton.type = 'button'
    this.copyButton.className = 'md-code-copy'
    this.copyButton.setAttribute('aria-label', '复制代码')
    this.copyButton.textContent = '复制代码'
    this.copyButton.onclick = () => {
      void textClipboard.writeText(this.cm.state.doc.toString()).then(() => {
        const orig = this.copyButton.textContent
        this.copyButton.textContent = '已复制'
        setTimeout(() => {
          if (!this.dead) this.copyButton.textContent = orig
        }, 1500)
      }).catch(error => window.dispatchEvent(new CustomEvent('editor-notice', { detail: String(error) })))
    }

    // Language selector (bottom-right)
    const langWrapper = document.createElement('div')
    langWrapper.className = 'md-code-lang'
    this.select.setAttribute('aria-label', '代码语言')
    this.select.value = node.attrs.params
    this.select.placeholder = '语言'
    this.select.className = 'md-code-lang-input'

    const list = document.createElement('datalist')
    list.id = `md-languages-${Math.random().toString(36).slice(2)}`
    for (const name of languageNames) {
      const option = document.createElement('option')
      option.value = name
      list.append(option)
    }
    this.select.setAttribute('list', list.id)
    this.select.onchange = () => {
      const pos = this.getPos()
      if (pos !== undefined) {
        this.outer.dispatch(
          this.outer.state.tr.setNodeMarkup(pos, undefined, {
            ...this.node.attrs,
            params: this.select.value.replace(/[\r\n]/g, ''),
          })
        )
      }
    }
    langWrapper.append(this.select, list)

    // Mermaid specific controls
    this.diagram.className = 'md-diagram'
    this.diagramToolbar.className = 'md-diagram-toolbar'

    this.renderButton.type = 'button'
    this.renderButton.className = 'md-diagram-btn'
    this.renderButton.textContent = '渲染 Mermaid'
    this.renderButton.onclick = () => this.renderMermaidDiagram()

    this.editSourceButton.type = 'button'
    this.editSourceButton.className = 'md-diagram-btn'
    this.editSourceButton.textContent = '编辑图表源码'
    this.editSourceButton.onclick = () => {
      this.isEditingMermaid = !this.isEditingMermaid
      this.editSourceButton.textContent = this.isEditingMermaid ? '完成编辑' : '编辑图表源码'
      this.cmContainer.hidden = !this.isEditingMermaid
      if (!this.isEditingMermaid) {
        this.renderMermaidDiagram()
      } else {
        this.cm.focus()
      }
    }

    this.diagramToolbar.append(this.editSourceButton, this.renderButton)
    this.diagramToolbar.hidden = !this.isMermaid
    this.diagram.hidden = !this.isMermaid

    // CodeMirror Container
    this.cmContainer.className = 'md-code-editor-wrap'

    this.dom.append(this.copyButton, this.diagramToolbar, this.diagram, this.cmContainer, langWrapper)

    // Build embedded CodeMirror
    this.cm = new CMView({
      parent: this.cmContainer,
      state: CMState.create({
        doc: node.textContent,
        extensions: [
          this.language.of([]),
          this.numbers.of(settings.codeLineNumbers ? lineNumbers() : []),
          this.wrap.of(settings.codeWrap ? CMView.lineWrapping : []),
          syntaxHighlighting(defaultHighlightStyle),
          search({ top: false }),
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
              const sel = update.state.selection.main
              this.outer.dispatch(
                this.outer.state.tr.setSelection(
                  TextSelection.create(this.outer.state.doc, pos + 1 + sel.anchor, pos + 1 + sel.head)
                )
              )
            }
          }),
        ],
      }),
    })

    this.setLanguage()

    if (this.isMermaid) {
      this.copyButton.hidden = true
      this.diagram.hidden = true
      this.cmContainer.hidden = false
      this.isEditingMermaid = true
    }
  }

  private async renderMermaidDiagram() {
    this.renderButton.disabled = true
    this.diagram.hidden = false
    this.diagram.textContent = '图表加载中…'
    try {
      const { renderDiagram } = await import('./renderers')
      await renderDiagram(this.diagram, this.node.textContent)
    } catch (error) {
      this.diagram.textContent = String(error)
    } finally {
      this.renderButton.disabled = false
    }
  }

  setSearchHighlight(query: string, caseSensitive: boolean, wholeWord: boolean, regexp: boolean) {
    if (!query) {
      this.cm.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) })
      return
    }
    try {
      this.cm.dispatch({
        effects: setSearchQuery.of(
          new SearchQuery({
            search: query,
            caseSensitive,
            wholeWord,
            regexp,
          })
        ),
      })
    } catch {
      // Ignore regex error inside CM
    }
  }

  private setLanguage() {
    const generation = ++this.generation
    const raw = this.node.attrs.params.trim().split(/\s/)[0]
    const name =
      languageNames.find(n => n.toLowerCase() === raw.toLowerCase()) || detectLanguage('code.' + raw)
    void loadLanguage(name as LanguageName)
      .then(extension => {
        if (!this.dead && generation === this.generation) {
          this.cm.dispatch({ effects: this.language.reconfigure(extension) })
        }
      })
      .catch(() => {})
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
    this.select.value = node.attrs.params

    this.isMermaid = /^mermaid(?:\s|$)/i.test(node.attrs.params)
    this.diagramToolbar.hidden = !this.isMermaid
    this.diagram.hidden = !this.isMermaid

    const current = this.cm.state.doc.toString()
    const next = node.textContent

    if (changed && this.isMermaid && !this.isEditingMermaid) {
      void this.renderMermaidDiagram()
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
        this.cmContainer.hidden = false
        this.isEditingMermaid = true
        this.editSourceButton.textContent = '完成编辑'
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
    this.dead = true
    this.generation++
    this.cm.destroy()
    this.select.onchange = null
  }
}
