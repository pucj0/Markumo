import { Annotation, Compartment, EditorState, EditorSelection, Prec, Transaction, Text, type Extension, type StateEffect, type TransactionSpec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { undo, redo, undoSelection, redoSelection, isolateHistory } from '@codemirror/commands'
import { openSearchPanel, findNext, findPrevious, SearchQuery } from '@codemirror/search'
import { indentUnit } from '@codemirror/language'
import { coreExtensions, editorTheme } from './extensions'
import { detectLanguage, loadLanguage, type LanguageName } from '../languages'
import { TabGroup } from '../../features/tabs/TabGroup'
import type { EditorDocument, Theme, MarkdownMode } from '../../types'
import { lineEndings, type LineEndingSnapshot } from './lineEndings'
import type { FileMetadata, OpenFile } from '../../features/files/contracts'
import { livePreviewExtension } from '../markdown/livePreview'
import { markdownFormatTransaction, type MarkdownFormat } from '../markdown/formatCommands'

export interface DocumentSeed { id: string; name: string; path: string; text: string; pinned?: boolean; mode?: MarkdownMode }
export type Pane = 'main' | 'secondary'
const sharedConfiguration = Annotation.define<boolean>()
interface CachedDocument {
  meta: EditorDocument
  state: EditorState
  baseline: Text
  baselineEndings: LineEndingSnapshot
  endings: ReturnType<typeof lineEndings>
  language: Compartment
  wrap: Compartment
  theme: Compartment
  markdownMode: Compartment
  indent: Compartment
  languageGeneration: number
  readyLanguageGeneration: number | null
  scroll: { top: number; left: number }
  panes: Record<Pane, { selection: EditorSelection; top: number; left: number }>
}

export class DocumentManager {
  readonly group = new TabGroup('main')
  readonly secondaryGroup = new TabGroup('secondary')
  isSplit = false
  activePane: 'main' | 'secondary' = 'main'

  private readonly records = new Map<string, CachedDocument>()
  private readonly seeds = new Map<string, DocumentSeed>()
  private readonly listeners = new Set<() => void>()
  private readonly deferred = new Map<string, StateEffect<unknown>[]>()
  private view: EditorView | null = null
  private secondaryView: EditorView | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private nextUntitled = 1
  private wordWrap = false
  private theme: Theme = 'dark'
  private defaultMarkdownMode: MarkdownMode = 'live'
  private indentSize = 2
  private useTabs = false
  private applying = false
  private fileModes: Record<string, MarkdownMode> = {}
  private disposed = false

  constructor(seeds: DocumentSeed[] = [], private readonly languageLoader = loadLanguage) {
    for (const seed of seeds) this.seeds.set(seed.id, seed)
  }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private notify() { for (const listener of this.listeners) listener() }
  get activeId() {
    return this.activePane === 'main' ? this.group.activeId : this.secondaryGroup.activeId
  }
  get activeDocument() { return this.activeId ? this.metadata(this.activeId) : null }
  get hasDirtyDocuments() { return [...this.records.values()].some(record => record.meta.dirty) }
  get isComposing() { return this.view?.compositionStarted || this.secondaryView?.compositionStarted || false }
  get catalog() { return [...this.seeds.values()].map(({ id, name, path }) => ({ id, name, path })) }
  get openedDocuments() { return [...new Set([...this.group.tabs, ...this.secondaryGroup.tabs].map(t => t.documentId))].map(id => this.metadata(id)!) }
  get mainOpenedDocuments() { return this.group.tabs.map(tab => this.metadata(tab.documentId)!) }
  get secondaryOpenedDocuments() { return this.secondaryGroup.tabs.map(tab => this.metadata(tab.documentId)!) }
  metadata(id: string): EditorDocument | null {
    const record = this.records.get(id)
    if (!record) return null
    const pane = this.activePane
    const selection = this.paneGroup(pane).activeId === id ? this.paneView(pane)?.state.selection || record.panes[pane].selection : record.state.selection
    const head = Math.min(selection.main.head, record.state.doc.length), line = record.state.doc.lineAt(head)
    return { ...record.meta, line: line.number, column: head - line.from + 1, pinned: this.group.tabs.find(tab => tab.documentId === id)?.pinned ?? this.secondaryGroup.tabs.find(tab => tab.documentId === id)?.pinned ?? true }
  }
  getState(id: string) { return this.records.get(id)?.state }
  getText(id: string) { return this.records.get(id)?.state.doc.toString() }

  private create(seed: DocumentSeed) {
    const language = new Compartment(), wrap = new Compartment(), theme = new Compartment(), markdownMode = new Compartment(), indent = new Compartment()
    const endings = lineEndings(seed.text)
    const isMd = /\.(md|markdown)$/i.test(seed.name)
    const initialMdMode: MarkdownMode | undefined = isMd ? (seed.mode || this.defaultMarkdownMode) : undefined

    const state = EditorState.create({
      doc: seed.text,
      extensions: [
        coreExtensions,
        indent.of([EditorState.tabSize.of(this.indentSize), indentUnit.of(this.useTabs ? '\t' : ' '.repeat(this.indentSize))]),
        Prec.highest(keymap.of([
          { key: 'Mod-z', run: () => { this.command('undo'); return true } },
          { key: 'Mod-Shift-z', run: () => { this.command('redo'); return true } },
          { key: 'Mod-y', run: () => { this.command('redo'); return true } },
          { key: 'Mod-u', run: () => { this.historyCommand(false, true); return true } },
          { key: 'Alt-u', mac: 'Mod-Shift-u', run: () => { this.historyCommand(true, true); return true } },
        ])),
        Prec.highest(EditorView.domEventHandlers({ beforeinput: event => {
          if (!['historyUndo','historyRedo'].includes(event.inputType)) return false
          event.preventDefault(); this.command(event.inputType === 'historyUndo' ? 'undo' : 'redo'); return true
        } })),
        endings.field,
        endings.history,
        language.of([]),
        markdownMode.of(isMd && initialMdMode === 'live' ? livePreviewExtension() : []),
        wrap.of(this.wordWrap ? EditorView.lineWrapping : []),
        theme.of(editorTheme(this.theme)),
        EditorView.contentAttributes.of({ 'aria-label': '文本编辑器', spellcheck: 'false' }),
        EditorView.updateListener.of(update => {
          if (this.applying) return
          if (update.focusChanged && update.view.hasFocus) this.focusPane(update.view === this.secondaryView ? 'secondary' : 'main', false)
        }),
      ],
    })
    const record: CachedDocument = {
      meta: {
        id: seed.id, uri: seed.id.startsWith('untitled-') ? `untitled:${seed.id}` : `sample:${seed.id}`, name: seed.name, path: seed.path,
        language: detectLanguage(seed.name), languageStatus: 'loading', dirty: false, pinned: seed.pinned ?? true,
        encoding: 'UTF-8', eol: /\r\n/.test(seed.text) ? 'CRLF' : 'LF', bom: false, readOnly: false, lastDiskVersion: null,
        charCount: state.doc.length, line: 1, column: 1, mode: initialMdMode,
      },
      state, baseline: state.doc, baselineEndings: endings.snapshot(state), endings, language, wrap, theme, markdownMode, indent, languageGeneration: 0, readyLanguageGeneration: null, scroll: { top: 0, left: 0 },
      panes: { main: { selection: state.selection, top: 0, left: 0 }, secondary: { selection: state.selection, top: 0, left: 0 } },
    }
    this.records.set(seed.id, record)
    void this.setLanguage(seed.id, record.meta.language)
    return record
  }

  openFile(file: OpenFile, preview = false) {
    if (this.disposed || this.isComposing) return null
    // A second open must never reload a dirty editor or reset its undo history.
    const existing = [...this.records.values()].find(record => record.meta.path === file.path && record.meta.fileToken)
    if (existing) { this.open(existing.meta.id, preview); return existing.meta.id }
    const id = `file:${file.token}`
    const seed = { id, name: file.name, path: file.path, text: file.text, pinned: !preview }
    this.seeds.set(id, seed)
    const record = this.create(seed)
    this.attachMetadata(record, file)
    this.restoreFileMode(record)
    this.open(id, preview)
    return id
  }

  private attachMetadata(record: CachedDocument, file: FileMetadata) {
    Object.assign(record.meta, { path: file.path, name: file.name, uri: `file:${file.path}`, fileToken: file.token,
      encoding: file.encoding, bom: file.bom, eol: file.eol, readOnly: file.readOnly, lastDiskVersion: file.version })
    // File seeds must not retain a second full text copy after closing.
    this.seeds.delete(record.meta.id)
  }
  private restoreFileMode(record: CachedDocument) {
    const mode = this.fileModes[record.meta.path]
    if (mode && /\.(md|markdown)$/i.test(record.meta.name) && record.meta.mode !== mode) {
      record.meta.mode = mode
      this.effects(record, [record.markdownMode.reconfigure(mode === 'live' ? livePreviewExtension() : [])])
    }
  }

  saveSnapshot(id: string) {
    const record = this.records.get(id)
    if (!record || this.isComposing) return null
    const state = record.state
    return { text: record.endings.serialize(state), metadata: this.metadata(id)!,
      complete: (file: FileMetadata) => {
        if (this.disposed || this.records.get(id) !== record) return false
        const previousName = record.meta.name
        record.baseline = state.doc
        record.baselineEndings = record.endings.snapshot(state)
        this.attachMetadata(record, file)
        this.updateMarkdownType(record, previousName)
        record.meta.dirty = !record.state.doc.eq(state.doc) || !record.endings.equal(record.state, record.baselineEndings)
        this.group.pin(id)
        if (previousName !== file.name) void this.setLanguage(id, detectLanguage(file.name))
        this.notify()
        return true
      },
    }
  }

  reloadFile(id: string, file: OpenFile) {
    const record = this.records.get(id)
    if (!record || record.meta.dirty || this.isComposing || this.disposed) return false
    this.deferred.delete(id)
    const seed = { id, name: file.name, path: file.path, text: file.text }
    const next = this.create(seed)
    this.attachMetadata(next, file)
    this.restoreFileMode(next)
    for (const pane of ['main', 'secondary'] as const) if (this.paneGroup(pane).activeId === id) this.showActive(pane)
    this.notify()
    return true
  }

  renamePath(oldPath: string, newPath: string, newName: string): boolean {
    const record = [...this.records.values()].find(r => r.meta.path === oldPath)
    if (!record) return false
    const previousName = record.meta.name
    record.meta.path = newPath
    record.meta.name = newName
    record.meta.uri = `file:${newPath}`
    this.updateMarkdownType(record, previousName)
    void this.setLanguage(record.meta.id, detectLanguage(newName))
    this.notify()
    return true
  }

  revealPosition(id: string, lineNumber: number, columnNumber: number) {
    const record = this.records.get(id)
    if (!record) return
    const doc = record.state.doc
    const targetLine = Math.min(Math.max(1, lineNumber), doc.lines)
    const line = doc.line(targetLine)
    const col = Math.min(Math.max(1, columnNumber), line.length + 1)
    const pos = line.from + (col - 1)
    this.dispatch(id, {
      selection: { anchor: pos, head: pos },
      scrollIntoView: true,
    })
    if (this.activeId === id) this.paneView(this.activePane)?.focus()
  }

  open(id: string, preview = true, pane: Pane = this.activePane) {
    if (this.disposed || this.isComposing) return false
    let record = this.records.get(id)
    if (!record) {
      const seed = this.seeds.get(id)
      if (!seed) return false
      record = this.create(seed)
    }
    this.captureScroll(pane)
    const group = this.paneGroup(pane), previousId = group.activeId
    const replaced = group.open(id, preview)
    if (replaced) this.release(replaced)
    this.activePane = pane
    if (previousId !== id) this.showActive(pane)
    this.notify()
    return true
  }

  select(id: string, pane: Pane = this.activePane) {
    if (!this.paneGroup(pane).tabs.some(tab => tab.documentId === id)) return false
    return this.open(id, true, pane)
  }
  pin(id: string) { this.group.pin(id); this.secondaryGroup.pin(id); this.notify() }
  createUntitled(extension: 'txt' | 'md' = 'txt') {
    if (this.isComposing || this.disposed) return null
    const count = this.nextUntitled++
    const id = `untitled-${count}`
    this.seeds.set(id, { id, name: `Untitled-${count}.${extension}`, path: '', text: '' })
    this.open(id, false)
    this.paneView(this.activePane)?.focus()
    return id
  }

  close(id: string, discard = false, pane: Pane = this.activePane): 'closed' | 'dirty' | 'composing' | 'missing' {
    const group = this.paneGroup(pane), other = this.paneGroup(pane === 'main' ? 'secondary' : 'main')
    if (!this.records.has(id) || !group.tabs.some(t => t.documentId === id)) return 'missing'
    if (this.isComposing) return 'composing'
    if (this.records.get(id)!.meta.dirty && !discard && !other.tabs.some(t => t.documentId === id)) return 'dirty'
    this.captureScroll(pane)
    const wasActive = group.activeId === id
    group.close(id)
    this.release(id)
    if (!this.records.has(id) && id.startsWith('untitled-')) this.seeds.delete(id)
    if (wasActive) this.showActive(pane)
    this.notify()
    return 'closed'
  }

  private release(id: string) {
    if ([...this.group.tabs, ...this.secondaryGroup.tabs].some(t => t.documentId === id)) return
    this.records.delete(id); this.deferred.delete(id)
  }
  private paneGroup(pane: Pane) { return pane === 'main' ? this.group : this.secondaryGroup }
  private paneView(pane: Pane) { return pane === 'main' ? this.view : this.secondaryView }
  focusPane(pane: Pane, focus = true) {
    if (pane === 'secondary' && !this.isSplit) return
    this.activePane = pane
    if (focus) this.paneView(pane)?.focus()
    this.notify()
  }
  private captureScroll(pane: Pane = this.activePane) {
    const id = this.paneGroup(pane).activeId, record = id && this.records.get(id), view = this.paneView(pane)
    if (record && view) {
      record.panes[pane] = { selection: view.state.selection, top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft }
      if (pane === 'main') record.scroll = { top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft }
    }
  }
  private showActive(pane: Pane = this.activePane) {
    const view = this.paneView(pane), targetId = this.paneGroup(pane).activeId
    if (!view) return
    const record = targetId && this.records.get(targetId)
    if (!record) { view.setState(EditorState.create()); return }
    view.setState(record.state.update({ selection: record.panes[pane].selection, annotations: Transaction.addToHistory.of(false) }).state)
    const scroll = { ...record.panes[pane] }
    view.requestMeasure({
      read: () => scroll,
      write: saved => {
        if (this.paneView(pane) === view && this.paneGroup(pane).activeId === targetId) {
          view.scrollDOM.scrollTop = saved.top
          view.scrollDOM.scrollLeft = saved.left
        }
      },
    })
  }

  mount(parent: HTMLElement) {
    if (this.disposed || this.view) return
    const id = this.group.activeId, record = id && this.records.get(id)
    this.view = new EditorView({ parent, state: record ? record.state : EditorState.create(), dispatchTransactions: trs => this.applyTransactions('main', trs) })
    this.showActive('main')
    if (record) this.view.focus()
  }

  mountSecondary(parent: HTMLElement) {
    if (this.disposed || this.secondaryView) return
    const id = this.secondaryGroup.activeId
    const record = id && this.records.get(id)
    this.secondaryView = new EditorView({
      parent,
      state: record ? record.state : EditorState.create(),
      dispatchTransactions: trs => this.applyTransactions('secondary', trs),
    })
    this.showActive('secondary')
  }

  splitEditor(): boolean {
    if (this.disposed || this.isComposing) return false
    if (this.isSplit) return true
    this.isSplit = true
    const currentId = this.group.activeId
    if (currentId) {
      this.secondaryGroup.open(currentId, false)
    }
    this.notify()
    return true
  }

  closeSplit() {
    if (this.isComposing) return false
    this.captureScroll('secondary')
    for (const tab of this.secondaryGroup.tabs) if (!this.group.tabs.some(t => t.documentId === tab.documentId)) {
      this.group.tabs.push({ ...tab, pinned: true })
      const record = this.records.get(tab.documentId)
      if (record) record.panes.main = { ...record.panes.secondary }
    }
    if (!this.group.activeId) this.group.activeId = this.secondaryGroup.activeId
    this.isSplit = false
    this.secondaryView?.destroy()
    this.secondaryView = null
    this.secondaryGroup.tabs.length = 0
    this.secondaryGroup.activeId = null
    this.activePane = 'main'
    this.showActive('main')
    this.notify()
    return true
  }

  moveTab(id: string, from: Pane, to: Pane) {
    if (this.isComposing || from === to || !this.paneGroup(from).tabs.some(t => t.documentId === id)) return false
    if (to === 'secondary' && !this.isSplit) this.splitEditor()
    this.captureScroll(from)
    const record = this.records.get(id)
    if (record && !this.paneGroup(to).tabs.some(t => t.documentId === id)) record.panes[to] = { ...record.panes[from] }
    this.paneGroup(to).open(id, false)
    this.paneGroup(from).close(id)
    this.activePane = to
    this.showActive(from); this.showActive(to); this.notify()
    return true
  }

  private applyTransactions(pane: Pane, transactions: readonly Transaction[]) {
    const view = this.paneView(pane), id = this.paneGroup(pane).activeId, record = id && this.records.get(id)
    if (!view || !record) return
    this.applying = true
    try {
      view.update(transactions)
      for (const tr of transactions) {
        // Transaction is also a TransactionSpec. Preserve all annotations,
        // including CodeMirror's internal undo/redo history annotation.
        const canonical = record.state.update(tr)
        record.state = canonical.state
        record.panes[pane].selection = tr.state.selection
        const other: Pane = pane === 'main' ? 'secondary' : 'main', receiver = this.paneView(other)
        record.panes[other].selection = record.panes[other].selection.map(tr.changes)
        if (this.paneGroup(other).activeId === id && receiver && (tr.docChanged || tr.annotation(sharedConfiguration))) {
          receiver.update([receiver.state.update({ changes: tr.changes, effects: tr.effects,
            selection: receiver.state.selection.map(tr.changes), annotations: Transaction.addToHistory.of(false) })])
          record.panes[other].selection = receiver.state.selection
        }
        this.accept(record, record.state, tr.docChanged)
      }
    } finally { this.applying = false }
  }

  unmount(pane: Pane = 'main') {
    this.captureScroll(pane)
    this.paneView(pane)?.destroy()
    if (pane === 'main') this.view = null
    else this.secondaryView = null
  }

  setIndent(size: number, tabs: boolean) {
    if (!Number.isInteger(size) || size < 1 || size > 8) return
    this.indentSize = size; this.useTabs = tabs
    for (const record of this.records.values()) this.effects(record, [record.indent.reconfigure([EditorState.tabSize.of(size), indentUnit.of(tabs ? '\t' : ' '.repeat(size))])])
  }

  transformSelection(upper: boolean) {
    const id = this.activeId, view = this.paneView(this.activePane), record = id && this.records.get(id)
    if (!record || this.isComposing) return
    const state = view?.state || record.state
    if (state.readOnly) return
    const changes = state.selection.ranges.filter(r => !r.empty).map(r => ({ from: r.from, to: r.to, insert: upper ? state.sliceDoc(r.from, r.to).toUpperCase() : state.sliceDoc(r.from, r.to).toLowerCase() }))
    if (id && changes.length) this.dispatch(id, { changes, annotations: isolateHistory.of('full'), userEvent: 'input.case' })
  }

  formatMarkdown(format: MarkdownFormat) {
    const id = this.activeId, record = id && this.records.get(id), view = this.paneView(this.activePane)
    if (!id || !record || this.isComposing || !/\.(md|markdown)$/i.test(record.meta.name)) return false
    const state = view?.state || record.state
    if (state.readOnly) return false
    this.dispatch(id, markdownFormatTransaction(state, format))
    view?.focus()
    return true
  }

  switchPane() {
    if (this.isSplit && !this.isComposing) this.focusPane(this.activePane === 'main' ? 'secondary' : 'main')
  }

  private activeViewFor(id: string) {
    if (this.paneGroup(this.activePane).activeId === id) return this.paneView(this.activePane)
    if (this.group.activeId === id) return this.view
    if (this.secondaryGroup.activeId === id) return this.secondaryView
    return null
  }

  private historyCommand(forward: boolean, selection = false) {
    const id = this.activeId, record = id && this.records.get(id)
    const command = selection ? (forward ? redoSelection : undoSelection) : forward ? redo : undo
    if (record && id) command({ state: record.state, dispatch: tr => this.dispatch(id, tr) })
  }

  gotoLine(id: string, line: number, column = 1) {
    this.revealPosition(id, line, column)
  }

  replaceAll(
    id: string,
    searchText: string,
    replaceText: string,
    options: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean } = {}
  ): number {
    const record = this.records.get(id)
    if (!record || !searchText || this.isComposing || record.state.readOnly) return 0
    const query = new SearchQuery({ search: searchText, replace: replaceText, literal: true, regexp: options.regex, caseSensitive: options.caseSensitive, wholeWord: options.wholeWord })
    if (!query.valid) return 0
    const cursor = query.getCursor(record.state)
    const changes: { from: number; to: number; insert: string }[] = []
    for (let item = cursor.next(); !item.done; item = cursor.next()) {
      const value = item.value
      let insert = replaceText
      if (options.regex && 'match' in value && Array.isArray(value.match)) {
        const match: (string | undefined)[] = value.match
        insert = replaceText.replace(/\$([$&]|\d+)/g, (raw, key: string) => {
          if (key === '$') return '$'
          if (key === '&') return match[0] || ''
          for (let length = key.length; length > 0; length--) {
            const group = Number(key.slice(0,length))
            if (group > 0 && group < match.length) return (match[group] || '') + key.slice(length)
          }
          return raw
        })
      }
      changes.push({ from: value.from, to: value.to, insert })
    }

    if (changes.length > 0) {
      this.dispatch(id, { changes, annotations: isolateHistory.of('full'), userEvent: 'input.replace' })
    }
    return changes.length
  }
  private accept(record: CachedDocument, state: EditorState, docChanged: boolean) {
    record.state = state
    if (docChanged) {
      record.meta.dirty = !state.doc.eq(record.baseline) || !record.endings.equal(state, record.baselineEndings)
      record.meta.charCount = state.doc.length
      this.group.pin(record.meta.id)
      this.secondaryGroup.pin(record.meta.id)
    }
    const position = state.selection.main.head
    const line = state.doc.lineAt(position)
    record.meta.line = line.number
    record.meta.column = position - line.from + 1
    this.notify()
  }
  dispatch(id: string, spec: TransactionSpec) {
    const record = this.records.get(id)
    if (!record) return
    const view = this.activeViewFor(id)
    if (view) view.dispatch(view.state.update(spec))
    else {
      const transaction = record.state.update(spec)
      for (const pane of ['main', 'secondary'] as const) record.panes[pane].selection = record.panes[pane].selection.map(transaction.changes)
      record.panes[this.activePane].selection = transaction.state.selection
      this.accept(record, transaction.state, transaction.docChanged)
    }
  }
  private effects(record: CachedDocument, effects: StateEffect<unknown>[]) {
    if (this.activeId === record.meta.id && this.isComposing) {
      this.deferred.set(record.meta.id, [...(this.deferred.get(record.meta.id) || []), ...effects])
      this.scheduleDeferred()
      return false
    }
    this.dispatch(record.meta.id, { effects, annotations: [Transaction.addToHistory.of(false), sharedConfiguration.of(true)] })
    return true
  }
  private scheduleDeferred() {
    if (this.timer || this.disposed) return
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.isComposing) { this.scheduleDeferred(); return }
      const deferred = [...this.deferred]
      this.deferred.clear()
      for (const [id, effects] of deferred) {
        const record = this.records.get(id)
        if (record) {
          this.effects(record, effects)
          if (record.readyLanguageGeneration === record.languageGeneration) record.meta.languageStatus = 'ready'
        }
      }
      this.notify()
    }, 50)
  }

  async setLanguage(id: string, language: LanguageName) {
    const record = this.records.get(id)
    if (!record || this.disposed) return
    const generation = ++record.languageGeneration
    record.readyLanguageGeneration = null
    record.meta.language = language
    record.meta.languageStatus = 'loading'
    record.meta.languageError = undefined
    this.effects(record, [record.language.reconfigure([])])
    this.notify()
    try {
      const extension: Extension = await this.languageLoader(language)
      if (this.disposed || this.records.get(id) !== record || generation !== record.languageGeneration) return
      record.readyLanguageGeneration = generation
      record.meta.languageStatus = this.effects(record, [record.language.reconfigure(extension)]) ? 'ready' : 'loading'
    } catch {
      if (this.disposed || this.records.get(id) !== record || generation !== record.languageGeneration) return
      record.meta.languageStatus = 'error'
      record.meta.languageError = '语言包加载失败；当前仍可作为纯文本编辑，请重新选择语言以重试。'
    }
    this.notify()
  }
  setMarkdownMode(id: string, mode: MarkdownMode): boolean {
    const record = this.records.get(id)
    if (!record || !/\.(md|markdown)$/i.test(record.meta.name) || !['live', 'source', 'split'].includes(mode) || this.disposed || this.isComposing) return false
    record.meta.mode = mode
    const extension = mode === 'live' ? livePreviewExtension() : []
    this.effects(record, [record.markdownMode.reconfigure(extension)])
    this.notify()
    return true
  }
  setDefaultMarkdownMode(mode: MarkdownMode) { this.defaultMarkdownMode = mode }
  setFileModes(modes: Record<string, MarkdownMode>) { this.fileModes = { ...modes } }
  private updateMarkdownType(record: CachedDocument, previousName: string) {
    const wasMarkdown = /\.(md|markdown)$/i.test(previousName)
    const isMarkdown = /\.(md|markdown)$/i.test(record.meta.name)
    if (wasMarkdown === isMarkdown) return
    record.meta.mode = isMarkdown ? this.defaultMarkdownMode : undefined
    this.effects(record, [record.markdownMode.reconfigure(record.meta.mode === 'live' ? livePreviewExtension() : [])])
  }
  setWrap(wrap: boolean) {
    this.wordWrap = wrap
    for (const record of this.records.values()) this.effects(record, [record.wrap.reconfigure(wrap ? EditorView.lineWrapping : [])])
  }
  setTheme(theme: Theme) {
    this.theme = theme
    for (const record of this.records.values()) this.effects(record, [record.theme.reconfigure(editorTheme(theme))])
  }
  refreshTypography() { this.setTheme(this.theme) }
  command(command: 'undo' | 'redo' | 'find' | 'replace' | 'find-next' | 'find-previous') {
    const view = this.paneView(this.activePane)
    if (!this.activeId || this.isComposing) return
    view?.focus()
    if (command === 'undo') this.historyCommand(false)
    else if (command === 'redo') this.historyCommand(true)
    else if (!view) return
    else if (command === 'find-next') findNext(view)
    else if (command === 'find-previous') findPrevious(view)
    else {
      openSearchPanel(view)
      const searchInput = view.dom.querySelector<HTMLInputElement>('.cm-search input[name="search"]')
      searchInput?.focus()
      if (command === 'replace') {
        const field = view.dom.querySelector<HTMLInputElement>('.cm-search input[name="replace"]')
        if (field?.parentElement) field.parentElement.hidden = false
        const toggle = view.dom.querySelector('.cm-search button[name="toggleReplace"]')
        if (toggle) { toggle.setAttribute('aria-expanded', 'true'); toggle.textContent = '⌄' }
        field?.focus()
      }
    }
  }
  dispose() {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.view?.destroy()
    this.secondaryView?.destroy()
    this.secondaryView = null
    this.view = null
    this.records.clear(); this.seeds.clear(); this.deferred.clear(); this.listeners.clear()
  }
}
