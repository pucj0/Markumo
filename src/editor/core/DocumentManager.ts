import { Annotation, Compartment, EditorState, EditorSelection, Prec, Transaction, Text, type Extension, type StateEffect, type TransactionSpec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { undo, redo, undoSelection, redoSelection, isolateHistory, deleteLine, copyLineDown, moveLineUp, moveLineDown, toggleComment } from '@codemirror/commands'
import { findNext, findPrevious } from '@codemirror/search'
import { showEditorSearch } from './searchPanel'
import { createSearchQuery, expandReplacement } from './searchQuery'
import { indentUnit, foldCode, unfoldCode } from '@codemirror/language'
import { coreExtensions, editorTheme } from './extensions'
import { detectLanguage, loadLanguage, type LanguageName } from '../languages'
import { TabGroup } from '../../features/tabs/TabGroup'
import { EditorLayoutManager } from '../layout/EditorLayoutManager'
import type { SplitDirection } from '../layout/types'
import type { EditorDocument, Theme, MarkdownMode } from '../../types'
import { lineEndings, type LineEndingSnapshot } from './lineEndings'
import type { FileMetadata, OpenFile, ClassInfo } from '../../features/files/contracts'
import { classSummary } from '../../features/files/classSummary'
import { defaultMarkdownTypography, type MarkdownTypography, type LiveEditor } from '../markdown/wysiwyg/contracts'
import { markdownFormatTransaction, type MarkdownFormat } from '../markdown/formatCommands'
import { captureLineBaseline, savedLineBaseline } from './changeGutter'
import { createMarkdownResources, markdownResources, refreshMarkdownResources } from '../markdown/images'
import { imageImportBookmarks } from '../markdown/imageImport'
import { sameFilePath } from '../../features/files/pathKey'

export interface DocumentSeed { id: string; name: string; path: string; text: string; pinned?: boolean; mode?: MarkdownMode; kind?: 'text' | 'javaClass'; classInfo?: ClassInfo; encoding?: string }
export type Pane = string
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
  panes: Record<string, { selection: EditorSelection; top: number; left: number; mode?: MarkdownMode }>
}

export class DocumentManager {
  readonly layout = new EditorLayoutManager()
  private readonly views = new Map<string, EditorView>()
  private readonly hosts = new Map<string, HTMLElement>()
  private readonly liveViews = new Map<string, {id:string; editor:LiveEditor}>()
  private readonly liveLoads = new Map<string, object>()
  private liveOrigin: {pane:string;update:unknown}|null = null
  private markdownTypography = defaultMarkdownTypography()
  private readonly records = new Map<string, CachedDocument>()
  private readonly seeds = new Map<string, DocumentSeed>()
  private readonly listeners = new Set<() => void>()
  private readonly deferred = new Map<string, StateEffect<unknown>[]>()
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
    this.layout.subscribe(() => this.notify())
  }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  notify() { for (const listener of this.listeners) listener() }

  get isSplit() { return this.layout.getAllLeafIds().length > 1 }
  get group() { return this.layout.getPane(this.layout.activePaneId)?.group || this.layout.getPrimaryPane().group }
  get secondaryGroup() {
    const leaves = this.layout.getAllLeafIds()
    const otherId = leaves.find(id => id !== this.layout.activePaneId) || 'secondary'
    return this.layout.getPane(otherId)?.group || new TabGroup(otherId)
  }
  get activePaneId() { return this.layout.activePaneId }
  get activePane(): string { return this.layout.activePaneId }
  set activePane(id: string) { this.focusPane(id) }
  get activeId() { return this.layout.getPane(this.layout.activePaneId)?.group.activeId || null }
  get activeDocument() { return this.activeId ? this.metadata(this.activeId) : null }
  get activeEditorView() { return this.views.get(this.layout.activePaneId) || null }
  get activeLiveEditor() { return this.liveViews.get(this.layout.activePaneId)?.editor || null }
  get view() { return this.views.get('main') || this.views.get(this.layout.activePaneId) || null }
  get secondaryView() {
    const leaves = this.layout.getAllLeafIds()
    const otherId = leaves.find(id => id !== 'main')
    return (otherId && this.views.get(otherId)) || null
  }
  get hasDirtyDocuments() { return [...this.records.values()].some(record => record.meta.dirty) }
  get isComposing() {
    return this.layout.getAllLeafIds().some(pane => {
      const id = this.paneGroup(pane).activeId
      return !!id && this.records.has(id) && (!!this.paneView(pane)?.compositionStarted || !!this.liveViews.get(pane)?.editor.composing)
    })
  }
  get catalog() { return [...this.seeds.values()].map(({ id, name, path }) => ({ id, name, path })) }
  get openedDocuments() {
    const allDocIds = new Set<string>()
    for (const pane of this.layout.getAllPanes()) {
      for (const tab of pane.group.tabs) allDocIds.add(tab.documentId)
    }
    return [...allDocIds].map(id => this.metadata(id)!).filter(Boolean)
  }
  get mainOpenedDocuments() { return this.layout.getPrimaryPane().group.tabs.map(tab => this.metadata(tab.documentId)!).filter(Boolean) }
  get secondaryOpenedDocuments() {
    const leaves = this.layout.getAllLeafIds()
    const other = leaves.find(id => id !== 'main')
    return other ? (this.layout.getPane(other)?.group.tabs.map(tab => this.metadata(tab.documentId)!).filter(Boolean) || []) : []
  }

  metadata(id: string): EditorDocument | null {
    const record = this.records.get(id)
    if (!record) return null
    const pane = this.activePane
    if (!record.panes[pane]) record.panes[pane] = { selection: record.state.selection, top: 0, left: 0 }
    const selection = this.paneGroup(pane).activeId === id ? this.paneView(pane)?.state.selection || record.panes[pane].selection : record.state.selection
    const head = Math.min(selection.main.head, record.state.doc.length), line = record.state.doc.lineAt(head)
    const isPinned = this.layout.getAllPanes().some(p => p.group.tabs.some(tab => tab.documentId === id && tab.pinned))
    return { ...record.meta, line: line.number, column: head - line.from + 1, pinned: isPinned }
  }
  getState(id: string) { return this.records.get(id)?.state }
  getText(id: string) { return this.records.get(id)?.state.doc.toString() }

  private create(seed: DocumentSeed) {
    const language = new Compartment(), wrap = new Compartment(), theme = new Compartment(), markdownMode = new Compartment(), indent = new Compartment()
    const endings = lineEndings(seed.text)
    const binary = seed.kind === 'javaClass'
    const byteEditor = seed.encoding === 'Hex'
    const isMd = !binary && !byteEditor && /\.(md|markdown)$/i.test(seed.name)
    const initialMdMode: MarkdownMode | undefined = isMd ? (seed.mode || this.defaultMarkdownMode) : undefined

    const state = EditorState.create({
      doc: seed.text,
      extensions: [
        coreExtensions,
        imageImportBookmarks,
        markdownResources.of(createMarkdownResources(() => this.records.get(seed.id)?.meta.fileToken,()=>{const meta=this.records.get(seed.id)?.meta;return `${meta?.fileToken||''}|${meta?.path||''}`})),
        binary ? [EditorState.readOnly.of(true), EditorView.editable.of(false), EditorState.transactionFilter.of(tr => tr.docChanged ? [] : tr)] : [],
        indent.of([EditorState.tabSize.of(this.indentSize), indentUnit.of(this.useTabs ? '\t' : ' '.repeat(this.indentSize))]),
        Prec.highest(keymap.of([
          { key: 'Mod-z', run: () => { this.command('undo'); return true } },
          { key: 'Mod-Shift-z', run: () => { this.command('redo'); return true } },
          { key: 'Mod-y', run: () => { this.command('redo'); return true } },
          { key: 'Mod-b', run: () => { this.formatMarkdown('bold'); return true } },
          { key: 'Mod-i', run: () => { this.formatMarkdown('italic'); return true } },
          { key: 'Mod-u', run: () => { this.historyCommand(false, true); return true } },
          { key: 'Alt-u', mac: 'Mod-Shift-u', run: () => { this.historyCommand(true, true); return true } },
        ])),
        Prec.highest(EditorView.domEventHandlers({ compositioncancel: (_event, view) => {
          // Some hosts expose cancellation separately. End it through CM's public
          // event route, including Chromium EditContext, without touching internals.
          if (view.compositionStarted) {
            const target = (view.contentDOM as HTMLElement & { editContext?: EventTarget }).editContext || view.contentDOM
            target.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
          }
          return false
        }, beforeinput: event => {
          if (!['historyUndo','historyRedo'].includes(event.inputType)) return false
          event.preventDefault(); this.command(event.inputType === 'historyUndo' ? 'undo' : 'redo'); return true
        } })),
        endings.field,
        endings.history,
        language.of([]),
        markdownMode.of([]),
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
        kind: seed.kind || 'text', classInfo: seed.classInfo,
        language: binary || byteEditor ? 'Plain Text' : detectLanguage(seed.name), languageStatus: binary ? 'ready' : 'loading', dirty: false, pinned: seed.pinned ?? true,
        encoding: seed.encoding || 'UTF-8', eol: /\r\n/.test(seed.text) ? 'CRLF' : 'LF', bom: false, readOnly: false, lastDiskVersion: null,
        charCount: state.doc.length, line: 1, column: 1, mode: initialMdMode,
      },
      state, baseline: state.doc, baselineEndings: endings.snapshot(state), endings, language, wrap, theme, markdownMode, indent, languageGeneration: 0, readyLanguageGeneration: null, scroll: { top: 0, left: 0 },
      panes: { main: { selection: state.selection, top: 0, left: 0 }, secondary: { selection: state.selection, top: 0, left: 0 } },
    }
    this.records.set(seed.id, record)
    if (!binary) void this.setLanguage(seed.id, record.meta.language)
    return record
  }

  openFile(file: OpenFile, preview = false) {
    if (this.disposed || this.isComposing) return null
    // A second open must never reload a dirty editor or reset its undo history.
    // The same file may arrive with a different spelling (case, separators) from
    // the shell, so the lookup uses the shared path key rather than exact text.
    const existing = [...this.records.values()].find(record => record.meta.fileToken && sameFilePath(record.meta.path, file.path))
    if (existing) { this.open(existing.meta.id, preview); return existing.meta.id }
    const id = `file:${file.token}`
    const seed: DocumentSeed = { id, name: file.name, path: file.path, text: file.kind === 'javaClass' ? classSummary(file.classInfo) : file.text, pinned: !preview,
      kind: file.kind || 'text', classInfo: file.kind === 'javaClass' ? file.classInfo : undefined, encoding: file.encoding }
    this.seeds.set(id, seed)
    const record = this.create(seed)
    this.attachMetadata(record, file)
    this.restoreFileMode(record)
    this.open(id, preview)
    return id
  }

  private attachMetadata(record: CachedDocument, file: FileMetadata) {
    const previousToken=record.meta.fileToken,previousPath=record.meta.path
    Object.assign(record.meta, { path: file.path, name: file.name, uri: `file:${file.path}`, fileToken: file.token,
      encoding: file.encoding, bom: file.bom, eol: file.eol, readOnly: record.meta.kind === 'javaClass' || file.readOnly, lastDiskVersion: file.version })
    if(previousToken!==file.token||previousPath!==file.path)this.effects(record,[refreshMarkdownResources.of(null)])
    // File seeds must not retain a second full text copy after closing.
    this.seeds.delete(record.meta.id)
  }
  private restoreFileMode(record: CachedDocument) {
    if (record.meta.kind === 'javaClass' || record.meta.encoding === 'Hex') return
    const mode = this.fileModes[record.meta.path]
    if (mode && /\.(md|markdown)$/i.test(record.meta.name) && record.meta.mode !== mode) {
      record.meta.mode = mode
      this.effects(record, [record.markdownMode.reconfigure([])])
    }
  }

  saveSnapshot(id: string) {
    const record = this.records.get(id)
    if (!record || record.meta.kind === 'javaClass' || this.isComposing) return null
    const state = record.state
    const savedLines = captureLineBaseline(state)
    return { text: record.endings.serialize(state), metadata: this.metadata(id)!,
      complete: (file: FileMetadata) => {
        if (this.disposed || this.records.get(id) !== record) return false
        const previousName = record.meta.name
        record.baseline = state.doc
        record.baselineEndings = record.endings.snapshot(state)
        this.effects(record,[savedLineBaseline.of(savedLines)])
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

  reloadFile(id: string, file: OpenFile, force = false) {
    const record = this.records.get(id)
    if (!record || (!force && record.meta.dirty) || this.isComposing || this.disposed) return false
    this.deferred.delete(id)
    for(const pane of this.layout.getAllLeafIds())if(this.paneGroup(pane).activeId===id)this.destroyView(pane)
    const seed: DocumentSeed = { id, name: file.name, path: file.path, text: file.kind === 'javaClass' ? classSummary(file.classInfo) : file.text,
      kind: file.kind || 'text', classInfo: file.kind === 'javaClass' ? file.classInfo : undefined, encoding: file.encoding }
    const next = this.create(seed)
    this.attachMetadata(next, file)
    this.restoreFileMode(next)
    for (const pane of this.layout.getAllLeafIds()) if (this.paneGroup(pane).activeId === id) this.showActive(pane)
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
    this.effects(record,[refreshMarkdownResources.of(null)])
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
    const live=this.liveViews.get(this.activePane)
    if(live?.id===id){live.editor.reveal(pos);live.editor.focus();return}
    this.dispatch(id, {
      selection: { anchor: pos, head: pos },
      scrollIntoView: true,
    })
    if (this.activeId === id) this.paneView(this.activePane)?.focus()
  }

  resolvePaneId(pane: Pane): string {
    if (this.layout.panes.has(pane)) return pane
    if (pane === 'secondary') {
      const leaves = this.layout.getAllLeafIds()
      const other = leaves.find(id => id !== 'main')
      if (other) return other
    }
    if (pane === 'main') {
      return this.layout.getPrimaryPane().id
    }
    return pane
  }

  open(id: string, preview = true, pane: Pane = this.activePane) {
    if (this.disposed || this.isComposing) return false
    const targetPane = this.resolvePaneId(pane)
    let record = this.records.get(id)
    if (!record) {
      const seed = this.seeds.get(id)
      if (!seed) return false
      record = this.create(seed)
    }
    this.captureScroll(targetPane)
    const isMarkdown = /\.(md|markdown)$/i.test(record.meta.name)
    if (!record.panes[targetPane]) {
      record.panes[targetPane] = {
        selection: record.state.selection,
        top: 0,
        left: 0,
        mode: isMarkdown ? (record.meta.mode || this.defaultMarkdownMode || 'live') : undefined,
      }
    } else if (isMarkdown && !record.panes[targetPane].mode) {
      record.panes[targetPane].mode = record.meta.mode || this.defaultMarkdownMode || 'live'
    }
    const group = this.paneGroup(targetPane), previousId = group.activeId
    const canReplace = (docId: string) => {
      const rec = this.records.get(docId)
      return !rec?.meta.dirty
    }
    const replaced = group.open(id, preview, canReplace)
    if (replaced) this.release(replaced)
    this.activePane = targetPane
    if (previousId !== id) this.showActive(targetPane)
    this.notify()
    return true
  }

  select(id: string, pane: Pane = this.activePane) {
    const targetPane = this.resolvePaneId(pane)
    if (!this.paneGroup(targetPane).tabs.some(tab => tab.documentId === id)) return false
    return this.open(id, true, targetPane)
  }
  pin(id: string) {
    for (const pane of this.layout.getAllPanes()) pane.group.pin(id)
    this.notify()
  }
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
    const targetPane = this.resolvePaneId(pane)
    const group = this.paneGroup(targetPane)
    if (!this.records.has(id) || !group.tabs.some(t => t.documentId === id)) return 'missing'
    if (this.isComposing) return 'composing'

    const isLastRef = !this.layout.getAllPanes().some(p => p.id !== targetPane && p.group.tabs.some(t => t.documentId === id))
    if (isLastRef && this.records.get(id)!.meta.dirty && !discard) return 'dirty'

    this.captureScroll(targetPane)
    const wasActive = group.activeId === id
    const res = this.layout.closeTab(targetPane, id)
    if (isLastRef) {
      this.release(id)
      if (!this.records.has(id) && id.startsWith('untitled-')) this.seeds.delete(id)
    }

    if (res.paneRemoved) {
      this.destroyView(targetPane)
      this.hosts.delete(targetPane)
      this.showActive(this.layout.activePaneId)
    } else if (wasActive) {
      this.showActive(targetPane)
    }
    this.notify()
    return 'closed'
  }

  private release(id: string) {
    if (this.layout.getAllPanes().some(p => p.group.tabs.some(t => t.documentId === id))) return
    this.records.delete(id); this.deferred.delete(id)
  }
  paneGroup(pane: Pane) {
    const resolved = this.resolvePaneId(pane)
    return this.layout.getPane(resolved)?.group || this.layout.getPrimaryPane().group
  }
  paneView(pane: Pane) {
    const resolved = this.resolvePaneId(pane)
    return this.views.get(resolved) || null
  }
  focusPane(pane: Pane, focus = true) {
    const resolved = this.resolvePaneId(pane)
    if (resolved !== this.activePane && this.isComposing) return
    this.layout.focusPane(resolved)
    if (focus) { this.views.get(resolved)?.focus();this.liveViews.get(resolved)?.editor.focus() }
    this.notify()
  }
  private captureScroll(pane: Pane = this.activePane) {
    const resolved = this.resolvePaneId(pane)
    const id = this.paneGroup(resolved).activeId, record = id && this.records.get(id), view = this.paneView(resolved)
    const live=this.liveViews.get(resolved)
    if(record&&live&&live.id===id){
      const selection=live.editor.selection,root=this.hosts.get(resolved)?.querySelector('.markdown-live')
      record.panes[resolved]={selection:EditorSelection.single(selection.anchor,selection.head),top:root?.scrollTop||0,left:root?.scrollLeft||0}
      return
    }
    if (record && view) {
      record.panes[resolved] = { selection: view.state.selection, top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft }
      if (resolved === 'main') record.scroll = { top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft }
    }
  }
  private showActive(pane: Pane = this.activePane) {
    const resolved = this.resolvePaneId(pane)
    let view = this.paneView(resolved)
    const targetId = this.paneGroup(resolved).activeId
    const record = targetId && this.records.get(targetId)
    if (!record) { this.destroyView(resolved); return }
    if (!record.panes[resolved]) record.panes[resolved] = { selection: record.state.selection, top: 0, left: 0 }
    const paneMode = this.getMarkdownMode(record.meta.id, resolved)
    if(paneMode==='live' && record.state.doc.length<=1024*1024){
      const existing=this.liveViews.get(resolved)
      if(existing?.id===record.meta.id){existing.editor.sync(record.state.doc.toString());return}
      this.destroyView(resolved)
      const parent=this.hosts.get(resolved)
      if(!parent||this.disposed)return
      const load={};this.liveLoads.set(resolved,load)
      void import('../markdown/wysiwyg/MarkdownEditorController').then(({MarkdownEditorController})=>{
        if(this.disposed||this.liveLoads.get(resolved)!==load||this.paneGroup(resolved).activeId!==record.meta.id||this.getMarkdownMode(record.meta.id, resolved)!=='live'||this.hosts.get(resolved)!==parent)return
        const source=record.state.doc.toString(),saved=record.panes[resolved]
        const sibling=[...this.liveViews.values()].find(live=>live.id===record.meta.id)?.editor
        const editor=new MarkdownEditorController(parent,{
          source,anchor:saved.selection.main.anchor,head:saved.selection.main.head,resources:record.state.facet(markdownResources),typography:this.markdownTypography,
          publish:(expected,patch,update,isolated)=>{
            if(this.records.get(record.meta.id)!==record||record.state.doc.toString()!==expected||record.state.readOnly)return false
            this.liveOrigin={pane:resolved,update}
            try{this.dispatch(record.meta.id,{changes:patch,userEvent:'input.markdown',...(isolated?{annotations:isolateHistory.of('full')}:{})})}finally{this.liveOrigin=null}
            return true
          },
          selected:(anchor,head)=>{const selection=EditorSelection.single(Math.min(anchor,record.state.doc.length),Math.min(head,record.state.doc.length));record.panes[resolved].selection=selection;if(this.activePane===resolved)record.state=record.state.update({selection,annotations:Transaction.addToHistory.of(false)}).state;this.notify()},
          history:forward=>{this.focusPane(resolved,false);this.historyCommand(forward)},focus:()=>this.focusPane(resolved,false),
          openRelative:href=>window.dispatchEvent(new CustomEvent('markdown-open-relative',{detail:{id:record.meta.id,href}})),
          readOnly:()=>record.state.readOnly,
        },sibling instanceof MarkdownEditorController?sibling.bridge:undefined)
        this.liveViews.set(resolved,{id:record.meta.id,editor})
        this.liveLoads.delete(resolved)
        const root=parent.querySelector('.markdown-live');if(root){root.scrollTop=saved.top;root.scrollLeft=saved.left}
        this.notify()
      }).catch(error=>{if(this.liveLoads.get(resolved)===load){this.liveLoads.delete(resolved);parent.querySelector('.markdown-live')?.remove();this.setMarkdownMode(record.meta.id, 'source', resolved);this.showActive(resolved);window.dispatchEvent(new CustomEvent('editor-notice',{detail:`Markdown Live 加载失败，已切到源码：${String(error)}`}))}})
      return
    }
    if(this.liveViews.has(resolved)||this.liveLoads.has(resolved)){this.destroyView(resolved);view=null}
    if (!view) {
      const parent = this.hosts.get(resolved)
      if (!parent || this.disposed) return
      view = new EditorView({ parent, state: record.state, dispatchTransactions: trs => this.applyTransactions(resolved, trs) })
      this.views.set(resolved, view)
    }
    const shownView = view
    shownView.setState(record.state.update({ selection: record.panes[resolved].selection, annotations: Transaction.addToHistory.of(false) }).state)
    const scroll = { ...record.panes[resolved] }
    shownView.requestMeasure({
      read: () => scroll,
      write: saved => {
        if (this.paneView(resolved) === shownView && this.paneGroup(resolved).activeId === targetId) {
          shownView.scrollDOM.scrollTop = saved.top
          shownView.scrollDOM.scrollLeft = saved.left
        }
      },
    })
  }

  mount(parent: HTMLElement, pane: Pane = 'main') {
    const resolved = this.resolvePaneId(pane)
    this.mountPane(parent, resolved)
    this.paneView(resolved)?.focus()
  }

  mountSecondary(parent: HTMLElement) {
    const leaves = this.layout.getAllLeafIds()
    const otherId = leaves.find(id => id !== 'main') || 'secondary'
    this.mountPane(parent, otherId)
  }

  mountPane(parent: HTMLElement, pane: Pane) {
    const resolved = this.resolvePaneId(pane)
    if (this.disposed || this.hosts.get(resolved) === parent) return
    this.captureScroll(resolved)
    this.destroyView(resolved)
    this.hosts.set(resolved, parent)
    this.showActive(resolved)
  }

  splitEditor(): boolean {
    if (this.disposed || this.isComposing) return false
    if (this.isSplit) return true
    this.splitPane('right')
    return true
  }

  splitPane(direction: SplitDirection, targetPane: Pane = this.activePane, docId?: string): string {
    if (this.disposed || this.isComposing) return targetPane
    const resolvedTarget = this.resolvePaneId(targetPane)
    const targetGroup = this.paneGroup(resolvedTarget)
    const openDocId = docId || targetGroup.activeId || undefined
    this.captureScroll(resolvedTarget)
    const newPaneId = this.layout.splitPane(resolvedTarget, direction, openDocId)
    if (openDocId) {
      let record = this.records.get(openDocId)
      if (!record) {
        const seed = this.seeds.get(openDocId)
        if (seed) record = this.create(seed)
      }
      if (record) {
        const sourcePaneState = record.panes[resolvedTarget]
        const sourceMode = this.getMarkdownMode(openDocId, resolvedTarget)
        record.panes[newPaneId] = sourcePaneState
          ? { ...sourcePaneState, mode: sourceMode }
          : { selection: record.state.selection, top: 0, left: 0, mode: sourceMode }
      }
    }
    this.activePane = newPaneId
    this.showActive(newPaneId)
    this.notify()
    return newPaneId
  }

  closeSplit() {
    if (this.isComposing) return false
    return this.mergeAllPanes()
  }

  closePane(paneId: Pane): boolean {
    const resolved = this.resolvePaneId(paneId)
    if (this.disposed || this.isComposing) return false
    const leaves = this.layout.getAllLeafIds()
    if (leaves.length <= 1) return false

    const pane = this.layout.getPane(resolved)
    if (pane) {
      for (const tab of pane.group.tabs) {
        const isLast = !this.layout.getAllPanes().some(p => p.id !== resolved && p.group.tabs.some(t => t.documentId === tab.documentId))
        if (isLast && this.records.get(tab.documentId)?.meta.dirty) return false
      }
    }

    this.captureScroll(resolved)
    this.destroyView(resolved)
    this.hosts.delete(resolved)
    const closed = this.layout.closePane(resolved)
    if (closed) {
      this.showActive(this.layout.activePaneId)
      this.notify()
    }
    return closed
  }

  mergeAllPanes(): boolean {
    if (this.isComposing) return false
    const primaryId = this.layout.getPrimaryPane().id

    for (const paneId of this.layout.getAllLeafIds()) {
      if (paneId !== primaryId) {
        this.captureScroll(paneId)
        const pane = this.layout.getPane(paneId)
        if (pane) {
          for (const tab of pane.group.tabs) {
            const record = this.records.get(tab.documentId)
            if (record && !record.panes[primaryId]) {
              record.panes[primaryId] = { ...record.panes[paneId] }
            }
          }
        }
        this.destroyView(paneId)
        this.hosts.delete(paneId)
      }
    }
    this.layout.mergeAllPanes()
    this.activePane = primaryId
    this.showActive(primaryId)
    this.notify()
    return true
  }

  moveTab(id: string, from: Pane, to: Pane, targetIndex?: number) {
    const resolvedFrom = this.resolvePaneId(from)
    const resolvedTo = this.resolvePaneId(to)
    if (this.isComposing || !this.paneGroup(resolvedFrom).tabs.some(t => t.documentId === id)) return false
    this.captureScroll(resolvedFrom)
    const record = this.records.get(id)
    if (record && !record.panes[resolvedTo] && record.panes[resolvedFrom]) {
      record.panes[resolvedTo] = { ...record.panes[resolvedFrom] }
    }
    this.layout.moveTab(id, resolvedFrom, resolvedTo, targetIndex)
    this.showActive(resolvedFrom)
    this.showActive(resolvedTo)
    this.notify()
    return true
  }

  reorderTab(pane: Pane, id: string, targetIndex: number) {
    const resolved = this.resolvePaneId(pane)
    const reordered = this.layout.reorderTab(resolved, id, targetIndex)
    if (reordered) this.notify()
    return reordered
  }

  private applyTransactions(pane: Pane, transactions: readonly Transaction[]) {
    const resolved = this.resolvePaneId(pane)
    const view = this.paneView(resolved), id = this.paneGroup(resolved).activeId, record = id && this.records.get(id)
    if (!view || !record) return
    if (record.meta.kind === 'javaClass' && transactions.some(tr => tr.docChanged)) return
    this.applying = true
    try {
      view.update(transactions)
      for (const tr of transactions) {
        // Transaction is also a TransactionSpec. Preserve all annotations,
        // including CodeMirror's internal undo/redo history annotation.
        const canonical = record.state.update(tr)
        record.state = canonical.state
        if (!record.panes[resolved]) record.panes[resolved] = { selection: tr.state.selection, top: 0, left: 0 }
        record.panes[resolved].selection = tr.state.selection
        for (const otherPane of this.layout.getAllLeafIds()) {
          if (otherPane === resolved) continue
          if (!record.panes[otherPane]) record.panes[otherPane] = { selection: record.state.selection, top: 0, left: 0 }
          record.panes[otherPane].selection = record.panes[otherPane].selection.map(tr.changes)
          const receiver = this.paneView(otherPane)
          if (this.paneGroup(otherPane).activeId === id && receiver && (tr.docChanged || tr.annotation(sharedConfiguration))) {
            receiver.update([receiver.state.update({ changes: tr.changes, effects: tr.effects,
              selection: receiver.state.selection.map(tr.changes), annotations: Transaction.addToHistory.of(false) })])
            record.panes[otherPane].selection = receiver.state.selection
          }
        }
        this.accept(record, record.state, tr.docChanged)
      }
    } finally { this.applying = false }
  }

  unmount(pane: Pane = 'main') {
    const resolved = this.resolvePaneId(pane)
    this.captureScroll(resolved)
    this.destroyView(resolved)
    this.hosts.delete(resolved)
  }

  private destroyView(pane: Pane) {
    const resolved = this.resolvePaneId(pane)
    this.views.get(resolved)?.destroy()
    this.views.delete(resolved)
    this.liveViews.get(resolved)?.editor.destroy();this.liveViews.delete(resolved);this.liveLoads.delete(resolved)
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
    if (!id || !record || record.meta.encoding === 'Hex' || this.isComposing || !/\.(md|markdown)$/i.test(record.meta.name)) return false
    const live=this.liveViews.get(this.activePane)
    if(live?.id===id)return live.editor.format(format)
    const state = view?.state || record.state
    if (state.readOnly) return false
    this.dispatch(id, markdownFormatTransaction(state, format))
    view?.focus()
    return true
  }

  switchPane() {
    if (this.isSplit && !this.isComposing) this.layout.focusNextPane()
  }

  private activeViewFor(id: string) {
    const activeLeaf = this.layout.activePaneId
    if (this.paneGroup(activeLeaf).activeId === id) return this.views.get(activeLeaf) || null
    for (const pane of this.layout.getAllLeafIds()) {
      if (this.paneGroup(pane).activeId === id) return this.views.get(pane) || null
    }
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
    const query = createSearchQuery({ search: searchText, replace: replaceText, regexp: !!options.regex, caseSensitive: !!options.caseSensitive, wholeWord: !!options.wholeWord })
    if (!query.valid) return 0
    const cursor = query.getCursor(record.state)
    const changes: { from: number; to: number; insert: string }[] = []
    for (let item = cursor.next(); !item.done; item = cursor.next()) {
      const value = item.value
      let insert = replaceText
      if (options.regex && 'match' in value && Array.isArray(value.match)) {
        insert = expandReplacement(value.match as RegExpExecArray, replaceText)
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
      this.pin(record.meta.id)
    }
    const position = state.selection.main.head
    const line = state.doc.lineAt(position)
    record.meta.line = line.number
    record.meta.column = position - line.from + 1
    for(const [pane,live]of this.liveViews)if(live.id===record.meta.id){
      if(docChanged&&pane!==this.liveOrigin?.pane)live.editor.sync(state.doc.toString(),this.liveOrigin?.update)
      live.editor.refreshResources()
    }
    this.notify()
  }
  dispatch(id: string, spec: TransactionSpec) {
    const record = this.records.get(id)
    if (!record) return
    if (record.meta.kind === 'javaClass' && spec.changes) return
    const view = this.activeViewFor(id)
    if (view) view.dispatch(view.state.update(spec))
    else {
      const transaction = record.state.update(spec)
      for (const pane of this.layout.getAllLeafIds()) {
        if (!record.panes[pane]) record.panes[pane] = { selection: record.state.selection, top: 0, left: 0 }
        record.panes[pane].selection = record.panes[pane].selection.map(transaction.changes)
      }
      if (!record.panes[this.activePane]) record.panes[this.activePane] = { selection: transaction.state.selection, top: 0, left: 0 }
      else record.panes[this.activePane].selection = transaction.state.selection
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
    if (!record || record.meta.kind === 'javaClass' || (record.meta.encoding === 'Hex' && language !== 'Plain Text') || this.disposed) return
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
  getMarkdownMode(id?: string | null, pane: Pane = this.activePane): MarkdownMode | undefined {
    if (!id) return undefined
    const record = this.records.get(id)
    if (!record || record.meta.kind === 'javaClass' || record.meta.encoding === 'Hex' || !/\.(md|markdown)$/i.test(record.meta.name)) {
      return undefined
    }
    const resolved = this.resolvePaneId(pane)
    return record.panes[resolved]?.mode || record.meta.mode || this.defaultMarkdownMode || 'live'
  }
  setMarkdownMode(id: string, mode: MarkdownMode, pane?: Pane): boolean {
    const record = this.records.get(id)
    if (!record || record.meta.kind === 'javaClass' || record.meta.encoding === 'Hex' || !/\.(md|markdown)$/i.test(record.meta.name) || !['live', 'source', 'split'].includes(mode) || this.disposed || this.isComposing) return false
    if(mode==='live'&&record.state.doc.length>1024*1024){window.dispatchEvent(new CustomEvent('editor-notice',{detail:'Markdown 超过 1 Mi 字符安全预算，请使用源码或双栏模式。'}));return false}

    const resolved = this.resolvePaneId(pane || this.activePane)
    if (!record.panes[resolved]) {
      record.panes[resolved] = { selection: record.state.selection, top: 0, left: 0 }
    }
    this.captureScroll(resolved)
    record.panes[resolved].mode = mode

    // 只有当修改的是当前活动 Pane 或未传 pane 时，才同步更新 meta.mode 保持向下兼容
    if (!pane || resolved === this.resolvePaneId(this.activePane)) {
      record.meta.mode = mode
    }

    this.effects(record, [record.markdownMode.reconfigure([])])
    if (this.paneGroup(resolved).activeId === id) {
      this.destroyView(resolved)
      this.showActive(resolved)
    }
    this.notify()
    return true
  }
  setDefaultMarkdownMode(mode: MarkdownMode) { this.defaultMarkdownMode = mode }
  setFileModes(modes: Record<string, MarkdownMode>) { this.fileModes = { ...modes } }
  private updateMarkdownType(record: CachedDocument, previousName: string) {
    if (record.meta.kind === 'javaClass' || record.meta.encoding === 'Hex') return
    const wasMarkdown = /\.(md|markdown)$/i.test(previousName)
    const isMarkdown = /\.(md|markdown)$/i.test(record.meta.name)
    if (wasMarkdown === isMarkdown) return
    record.meta.mode = isMarkdown ? this.defaultMarkdownMode : undefined
    this.effects(record, [record.markdownMode.reconfigure([])])
    for(const pane of this.layout.getAllLeafIds())if(this.paneGroup(pane).activeId===record.meta.id){this.destroyView(pane);this.showActive(pane)}
  }
  setWrap(wrap: boolean) {
    this.wordWrap = wrap
    for (const record of this.records.values()) this.effects(record, [record.wrap.reconfigure(wrap ? EditorView.lineWrapping : [])])
    for (const view of this.views.values()) view.dispatch({ effects: [] })
  }
  setTheme(theme: Theme) {
    this.theme = theme
    for (const record of this.records.values()) this.effects(record, [record.theme.reconfigure(editorTheme(theme))])
  }
  refreshTypography() { this.setTheme(this.theme) }
  setMarkdownTypography(settings:MarkdownTypography){this.markdownTypography={...settings};for(const live of this.liveViews.values())live.editor.typography(settings);this.notify()}
  getMarkdownTypography(){return this.markdownTypography}
  command(command: 'undo' | 'redo' | 'find' | 'replace' | 'find-next' | 'find-previous' | 'delete-line' | 'copy-line-down' | 'move-line-up' | 'move-line-down' | 'comment-line' | 'fold-code' | 'unfold-code') {
    if (!this.activeId || this.isComposing) return
    if (command === 'undo') { this.historyCommand(false); return }
    if (command === 'redo') { this.historyCommand(true); return }
    const live = this.activeLiveEditor
    if (live) {
      if (command === 'find') live.find(false)
      else if (command === 'replace') live.find(true)
      else if (command === 'find-next') live.findNext()
      else if (command === 'find-previous') live.findPrevious()
      return
    }
    const view = this.paneView(this.activePane)
    if (!view) return
    view.focus()
    if (command === 'find-next') findNext(view)
    else if (command === 'find-previous') findPrevious(view)
    else if (command === 'delete-line') deleteLine(view)
    else if (command === 'copy-line-down') copyLineDown(view)
    else if (command === 'move-line-up') moveLineUp(view)
    else if (command === 'move-line-down') moveLineDown(view)
    else if (command === 'comment-line') toggleComment(view)
    else if (command === 'fold-code') foldCode(view)
    else if (command === 'unfold-code') unfoldCode(view)
    else showEditorSearch(view, command === 'replace')
  }
  dispose() {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    for (const view of this.views.values()) view.destroy()
    for(const live of this.liveViews.values())live.editor.destroy()
    this.liveViews.clear();this.liveLoads.clear()
    this.views.clear()
    this.hosts.clear()
    this.records.clear(); this.seeds.clear(); this.deferred.clear(); this.listeners.clear()
  }
}
