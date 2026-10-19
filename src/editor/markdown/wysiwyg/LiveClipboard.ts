import { AllSelection, TextSelection, type EditorState, type Selection } from 'prosemirror-state'
import { Slice } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { markdownSerializer } from './MarkdownSerializer'
import { parseMarkdown } from './MarkdownParser'
import type { MarkdownSourceBridge } from './MarkdownSourceBridge'
import type { MarkdownClipboardSettings } from './contracts'
import { textClipboard, writeRichClipboard } from '../../../features/shell/clipboard'

export type LiveClipboardOperation = 'copy' | 'cut' | 'paste' | 'select-all' | 'markdown' | 'html' | 'simplified' | 'paste-plain'
const renderer = new MarkdownIt({ html: false })

/** The logical source line, never a soft-wrapped screen row. */
function lineSelection(state: EditorState): Selection {
  const { $from } = state.selection
  if (!$from.parent.isTextblock) return state.selection
  const text = $from.parent.textBetween(0, $from.parent.content.size, '\n', node => /^(soft_break|hard_break)$/.test(node.type.name) ? '\n' : '\ufffc')
  const start = $from.parentOffset ? text.lastIndexOf('\n', $from.parentOffset - 1) + 1 : 0
  const newline = text.indexOf('\n', $from.parentOffset)
  const end = newline < 0 ? text.length : newline + 1
  return TextSelection.create(state.doc, $from.start() + start, $from.start() + end)
}

export class LiveClipboard {
  constructor(
    private view: EditorView,
    private settings: () => MarkdownClipboardSettings,
    private bridge: () => MarkdownSourceBridge,
    private editable: () => boolean,
    private alive: () => boolean,
  ) {}

  private selection(state: EditorState) {
    return state.selection.empty && this.settings().copyWholeLine ? lineSelection(state) : state.selection
  }

  content(state = this.view.state) {
    const selection = this.selection(state)
    if (selection.empty) return null
    const slice = selection.content()
    const full = selection instanceof AllSelection || (selection.from <= 1 && selection.to >= state.doc.content.size - 1)
    // A text selection inside one cell includes open table/row/cell wrappers in
    // its slice. Serialize the selected textblock alone, retaining inline marks
    // without inventing a table header and separators around a copied word.
    const inline = selection instanceof TextSelection && selection.$from.sameParent(selection.$to) && selection.$from.parent.isTextblock
    const selected = inline ? selection.$from.parent.cut(selection.$from.parentOffset, selection.$to.parentOffset) : slice.content
    const markdown = full ? this.bridge().source : markdownSerializer.serialize(state.schema.nodes.doc.create(null, selected))
    const plain = slice.content.textBetween(0, slice.content.size, '\n', node => {
      if (node.type.name === 'image') return node.attrs.alt || ''
      return node.attrs.latex || node.attrs.source || (/^(soft_break|hard_break)$/.test(node.type.name) ? '\n' : '')
    })
    const html = DOMPurify.sanitize(renderer.render(markdown), { USE_PROFILES: { html: true } })
    return { selection, markdown, plain, html, text: this.settings().copyMarkdown ? markdown : plain }
  }

  /** Native Ctrl+C/X and WebView edit commands use the same representations as
   * the app menus. Setting both MIME types avoids copying the editor's UI DOM. */
  event(event: ClipboardEvent, cut: boolean) {
    if (event.target instanceof Element && event.target.closest('input,textarea,.cm-editor')) return false
    if (cut && !this.editable()) { event.preventDefault(); return true }
    const content = this.content()
    if (!content || !event.clipboardData) return false
    event.preventDefault()
    event.clipboardData.setData('text/plain', content.text)
    event.clipboardData.setData('text/html', content.html)
    if (cut) this.remove(content.selection)
    return true
  }

  private remove(selection: Selection) {
    this.view.dispatch(this.view.state.tr.setSelection(selection).deleteSelection().setMeta('isolated', true).scrollIntoView())
  }

  async run(operation: LiveClipboardOperation) {
    const state = this.view.state
    if (operation === 'select-all') {
      this.view.dispatch(state.tr.setSelection(new AllSelection(state.doc)))
      return
    }
    const mutates = operation === 'cut' || operation === 'paste' || operation === 'paste-plain'
    if (mutates && !this.editable()) return
    if (operation === 'paste' || operation === 'paste-plain') {
      const text = await textClipboard.readText()
      if (!this.alive() || !this.editable()) return
      if (this.view.state !== state) throw new Error('读取剪贴板期间文档或选区变化，已取消粘贴')
      if (!text) return
      if (operation === 'paste-plain') this.view.dispatch(state.tr.insertText(text).setMeta('isolated', true).scrollIntoView())
      else this.view.dispatch(state.tr.replaceSelection(Slice.maxOpen(parseMarkdown(text).doc.content)).setMeta('isolated', true).scrollIntoView())
      return
    }
    const content = this.content(state)
    if (!content) return
    if (operation === 'markdown') await textClipboard.writeText(content.markdown)
    else if (operation === 'html') await textClipboard.writeText(content.html)
    else await writeRichClipboard(operation === 'simplified' ? content.plain : content.text, content.html)
    if (operation === 'cut' && this.alive() && this.editable() && this.view.state === state) this.remove(content.selection)
  }
}
