import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { CheckboxWidget, HorizontalRuleWidget, ListMarkerWidget } from './widgets'
import { openMarkdownLink, safeMarkdownURL } from './links'

const refresh = StateEffect.define<null>()
const refreshGeneration = StateField.define({ create: () => 0, update: (value: number, tr) => tr.effects.some(effect => effect.is(refresh)) ? value + 1 : value })

export function buildLiveDecorationsForState(state: EditorState, visibleRanges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }]): DecorationSet {
  const tree = syntaxTree(state)
  const decorations: ReturnType<Decoration['range']>[] = []
  const lineClasses = new Map<number, Set<string>>()
  const added = new Set<string>()
  const active = (from: number, to: number) => state.selection.ranges.some(range => range.from <= to && range.to >= from)
  const activeLine = (pos: number) => { const line = state.doc.lineAt(pos); return active(line.from, line.to) }
  const add = (from: number, to: number, decoration: Decoration, key: string) => {
    if (added.has(key)) return
    added.add(key); decorations.push(decoration.range(from, to))
  }
  const line = (pos: number, cls: string) => {
    const start = state.doc.lineAt(pos).from
    if (!lineClasses.has(start)) lineClasses.set(start, new Set())
    lineClasses.get(start)!.add(cls)
  }
  const hide = (from: number, to: number) => {
    if (to > from && state.doc.lineAt(from).number === state.doc.lineAt(to).number)
      add(from, to, Decoration.replace({ class: 'cm-md-mark-hidden' }), `hide-${from}-${to}`)
  }
  const mark = (from: number, to: number, cls: string, url?: string) => {
    if (to > from) add(from, to, Decoration.mark({ class: cls, ...(url ? { attributes: { 'data-md-link': url } } : {}) }), `${cls}-${from}-${to}`)
  }

  for (const visible of visibleRanges) {
    const from = Math.max(0, visible.from), to = Math.min(state.doc.length, visible.to)
    tree.iterate({ from, to, enter: node => {
      const name = node.name
      if (['FencedCode', 'CodeBlock', 'Table', 'Image'].includes(name)) return false
      if (/^(ATXHeading|SetextHeading)[1-6]$/.test(name)) {
        const level = name.match(/[1-6]$/)![0]
        const firstLine = state.doc.lineAt(node.from)
        if (firstLine.to >= from && firstLine.from <= to) line(node.from, `cm-md-heading cm-md-h${level}`)
        if (!activeLine(node.from) && !active(node.from, node.to)) {
          for (const token of node.node.getChildren('HeaderMark')) {
            if (token.from >= from && token.to <= to) hide(token.from, Math.min(token.to + (state.sliceDoc(token.to, token.to + 1) === ' ' ? 1 : 0), state.doc.lineAt(token.to).to))
          }
        }
      } else if (name === 'Paragraph' && node.node.parent?.name === 'Document') {
        const start = state.doc.lineAt(Math.max(node.from, from)).number
        const end = state.doc.lineAt(Math.min(node.to, to)).number
        for (let number = start; number <= end; number++) line(state.doc.line(number).from, 'cm-md-paragraph')
      } else if (['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode'].includes(name)) {
        const tokens = node.node.getChildren(name === 'InlineCode' ? 'CodeMark' : name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark')
        if (tokens.length >= 2) {
          const first = tokens[0], last = tokens[tokens.length - 1]
          const cls = { StrongEmphasis: 'cm-md-strong', Emphasis: 'cm-md-emphasis', Strikethrough: 'cm-md-strikethrough', InlineCode: 'cm-md-inline-code' }[name]!
          mark(Math.max(first.to, from), Math.min(last.from, to), cls)
          if (!active(node.from, node.to)) { hide(first.from, first.to); hide(last.from, last.to) }
        }
      } else if (name === 'TaskMarker' && !activeLine(node.from)) {
        add(node.from, node.to, Decoration.replace({ widget: new CheckboxWidget(/\[[xX]\]/.test(state.sliceDoc(node.from, node.to)), node.from) }), `task-${node.from}`)
      } else if (name === 'HorizontalRule' && !activeLine(node.from)) {
        add(node.from, node.to, Decoration.replace({ widget: new HorizontalRuleWidget() }), `rule-${node.from}`)
      } else if (name === 'Blockquote') {
        const start = state.doc.lineAt(Math.max(node.from, from)).number
        const end = state.doc.lineAt(Math.min(node.to, to)).number
        for (let number = start; number <= end; number++) line(state.doc.line(number).from, 'cm-md-blockquote')
      } else if (name === 'QuoteMark' && !activeLine(node.from)) {
        hide(node.from, Math.min(node.to + (state.sliceDoc(node.to, node.to + 1) === ' ' ? 1 : 0), state.doc.lineAt(node.to).to))
      } else if (name === 'ListItem') {
        if (node.from >= state.doc.lineAt(from).from && node.from <= to) line(node.from, 'cm-md-list')
      } else if (name === 'ListMark' && !activeLine(node.from)) {
        const raw = state.sliceDoc(node.from, node.to)
        add(node.from, node.to, Decoration.replace({ widget: new ListMarkerWidget(/^\d/.test(raw) ? raw : '•') }), `list-${node.from}`)
      } else if (name === 'Link') {
        const urlNode = node.node.getChild('URL')
        const tokens = node.node.getChildren('LinkMark')
        const url = urlNode && safeMarkdownURL(state.sliceDoc(urlNode.from, urlNode.to))
        if (url && tokens.length >= 2) {
          const first = tokens[0], textEnd = tokens[1].from
          mark(Math.max(first.to, from), Math.min(textEnd, to), 'cm-md-link', url)
          if (!active(node.from, node.to)) { hide(first.from, first.to); hide(textEnd, node.to) }
        }
      }
    } })
  }
  for (const [pos, classes] of lineClasses) decorations.push(Decoration.line({ class: [...classes].join(' ') }).range(pos))
  return Decoration.set(decorations, true)
}

export const livePreviewPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  private view: EditorView
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  constructor(view: EditorView) { this.view = view; this.decorations = buildLiveDecorationsForState(view.state, view.visibleRanges) }
  update(update: ViewUpdate) {
    // Map positions while IME owns its DOM. Freezing unmapped ranges corrupts the view.
    if (update.view.compositionStarted) { if (update.docChanged) this.decorations = this.decorations.map(update.changes); this.scheduleRefresh(30); return }
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged || syntaxTree(update.state) !== syntaxTree(update.startState) || update.state.field(refreshGeneration) !== update.startState.field(refreshGeneration))
      this.decorations = buildLiveDecorationsForState(update.state, update.view.visibleRanges)
  }
  compositionEnded() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.scheduleRefresh(0)
  }
  private scheduleRefresh(delay: number) {
    if (this.timer || this.disposed) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.disposed) return
      if (this.view.compositionStarted) { this.scheduleRefresh(30); return }
      this.view.dispatch({ effects: refresh.of(null) })
    }, delay)
  }
  destroy() { this.disposed = true; if (this.timer) clearTimeout(this.timer) }
}, { decorations: value => value.decorations, eventHandlers: {
  compositionend() { this.compositionEnded(); return false },
  mousedown(event, view) {
    if (!(event.ctrlKey || event.metaKey) || view.compositionStarted) return false
    const link = (event.target as HTMLElement).closest<HTMLElement>('[data-md-link]')?.dataset.mdLink
    if (!link) return false
    event.preventDefault(); void openMarkdownLink(link); return true
  },
} })
export function livePreviewExtension(): Extension { return [refreshGeneration, livePreviewPlugin] }
