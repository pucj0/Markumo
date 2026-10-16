import { EditorState, Plugin, TextSelection, Selection, NodeSelection, AllSelection, type Transaction, type Command } from 'prosemirror-state'
import { EditorView, type NodeView } from 'prosemirror-view'
import type { Node } from 'prosemirror-model'
import { baseKeymap, chainCommands, exitCode, liftEmptyBlock, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands'
import { keymap } from 'prosemirror-keymap'
import { inputRules, textblockTypeInputRule, wrappingInputRule, InputRule } from 'prosemirror-inputrules'
import { wrapInList, splitListItem, sinkListItem, liftListItem } from 'prosemirror-schema-list'
import { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow, deleteTable, goToNextCell, tableEditing, isInTable, selectedRect } from 'prosemirror-tables'
import { gapCursor } from 'prosemirror-gapcursor'
import { markdownSchema as s } from './MarkdownSchema'
import { MarkdownSourceBridge, textPatch, type SourcePatch } from './MarkdownSourceBridge'
import { InlineSourceView, inlineSourceRange } from './InlineSourceView'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { CodeBlockView } from './CodeBlockView'
import { LiveImageView } from './LiveImageView'
import { ImagePreview } from './ImagePreview'
import { FenceAutocomplete } from './FenceAutocomplete'
import { HtmlBlockView } from './HtmlBlockView'
import { HtmlInlineView } from './HtmlInlineView'
import { createLiveSearchPlugin } from './plugins/LiveSearch'
import { LiveSearchController } from './LiveSearchController'
import { createNodeTargetPlugin, nodeTargetKey, type NodeTarget } from './plugins/NodeTarget'
import { safeMarkdownURL, openMarkdownLink } from '../links'
import { textClipboard } from '../../../features/shell/clipboard'
import type { MarkdownFormat } from '../formatCommands'
import type { LiveEditor, LiveOptions, MarkdownTypography } from './contracts'
import 'prosemirror-view/style/prosemirror.css'
import 'prosemirror-tables/style/tables.css'
import 'prosemirror-gapcursor/style/gapcursor.css'
import './MarkdownTheme.css'

interface LiveUpdate { bridge: MarkdownSourceBridge; transactions: readonly Transaction[] }
let nodeIdentity = 0

function notice(error: unknown) {
  window.dispatchEvent(new CustomEvent('editor-notice', { detail: String(error) }))
}

export class MarkdownEditorController implements LiveEditor {
  readonly view: EditorView
  bridge: MarkdownSourceBridge
  readonly dom = document.createElement('div')
  private tableTools = document.createElement('div')
  private tableMenu = document.createElement('div')
  private imagePreview: ImagePreview
  private properties = document.createElement('div')
  private selectionBubble = document.createElement('div')
  private searchController: LiveSearchController
  private fenceAutocomplete: FenceAutocomplete
  private codeViews = new Set<CodeBlockView>()
  private liveImages = new Set<LiveImageView>()
  private extensionViews = new Set<() => void>()
  private compositionActive = false
  private onCompositionStart = () => {
    this.compositionActive = true
    this.fenceAutocomplete?.hide()
  }
  private settings: MarkdownTypography
  private disposed = false
  private pendingSource: string | null = null
  private wasReadOnly = false
  private currentAnchorEl: HTMLElement | null = null
  private propertyTargetToken: object | null = null
  private inlineSource: InlineSourceView | null = null
  private dismissedInline: { from:number; to:number } | null = null

  private onCompositionEnd = () => {
    this.compositionActive = false
    setTimeout(() => {
      if (!this.disposed && this.pendingSource !== null) {
        const source = this.pendingSource
        this.pendingSource = null
        this.sync(source)
      }
    }, 0)
  }

  constructor(parent: HTMLElement, private options: LiveOptions, sharedBridge?: MarkdownSourceBridge) {
    this.settings = options.typography
    // Panes must start from the same immutable PM document and source IDs.
    // Independent parses look equal on screen but force full-document syncs,
    // which destroy mapped property targets and selection/search continuity.
    this.bridge = sharedBridge?.source === options.source
      ? Object.assign(new MarkdownSourceBridge(''), sharedBridge)
      : new MarkdownSourceBridge(options.source)
    this.wasReadOnly = options.readOnly?.() ?? false

    this.dom.className = 'markdown-live'
    this.dom.setAttribute('aria-label', 'Markdown 所见即所得编辑器')

    // Floating Table Toolbar (anchored to active table)
    this.tableTools.className = 'md-table-tools md-table-floating-bar'
    this.tableTools.setAttribute('role', 'toolbar')
    this.tableTools.setAttribute('aria-label', '表格工具')
    this.tableTools.hidden = true

    // Floating Property Popover (anchored to link/image/math)
    this.properties.className = 'md-properties md-anchored-popover'
    this.properties.hidden = true

    // Floating Selection Bubble menu
    this.selectionBubble.className = 'md-selection-bubble'
    this.selectionBubble.hidden = true
    this.buildSelectionBubble()

    const mount = document.createElement('div')
    mount.className = 'md-document'

    this.dom.append(this.properties, this.selectionBubble, mount)
    parent.append(this.dom)
    this.imagePreview = new ImagePreview(this.dom)
    this.fenceAutocomplete = new FenceAutocomplete(this.dom)

    // Build Table Tools buttons
    const tableCommands: [string, Command][] = [
      ['前插行', addRowBefore],
      ['后插行', addRowAfter],
      ['删除行', deleteRow],
      ['前插列', addColumnBefore],
      ['后插列', addColumnAfter],
      ['删除列', deleteColumn],
    ]
    const iconButton = (label: string, path: string, action: () => void) => {
      const button = document.createElement('button')
      button.type = 'button'; button.title = label; button.setAttribute('aria-label', label)
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('aria-hidden','true')
      const shape = document.createElementNS(svg.namespaceURI,'path');shape.setAttribute('d',path);svg.append(shape);button.append(svg)
      button.onmousedown = event => event.preventDefault()
      button.onclick = action
      return button
    }
    const toggleMenu = () => {
      this.tableMenu.hidden = !this.tableMenu.hidden
      this.tableTools.querySelectorAll('[aria-expanded]').forEach(el=>el.setAttribute('aria-expanded',String(!this.tableMenu.hidden)))
    }
    const grid = iconButton('表格行列操作','M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',toggleMenu)
    grid.setAttribute('aria-expanded','false')
    this.tableTools.append(grid)
    for(const [label,value,path] of [
      ['左对齐','left','M3 5h18 M3 10h12 M3 15h18 M3 20h12'],
      ['居中对齐','center','M3 5h18 M6 10h12 M3 15h18 M6 20h12'],
      ['右对齐','right','M3 5h18 M9 10h12 M3 15h18 M9 20h12'],
    ]) {
      const button=iconButton(label,path,()=>this.run(this.align(value),true));button.dataset.align=value;this.tableTools.append(button)
    }
    const spacer=document.createElement('span');spacer.className='md-table-tools-spacer';this.tableTools.append(spacer)
    const more=iconButton('更多操作','M12 4h.01 M12 12h.01 M12 20h.01',toggleMenu);more.setAttribute('aria-expanded','false')
    this.tableTools.append(more,iconButton('删除表格','M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',()=>this.run(deleteTable,true)))
    this.tableMenu.className='md-table-menu';this.tableMenu.hidden=true;this.tableMenu.setAttribute('aria-label','表格行列操作菜单')
    for (const [label, command] of tableCommands) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.onmousedown = event => event.preventDefault()
      button.onclick = () => { this.tableMenu.hidden=true;this.tableTools.querySelectorAll('[aria-expanded]').forEach(el=>el.setAttribute('aria-expanded','false'));this.run(command, true) }
      this.tableMenu.append(button)
    }
    this.tableTools.append(this.tableMenu)
    const closeTableMenu=()=>{this.tableMenu.hidden=true;this.tableTools.querySelectorAll('[aria-expanded]').forEach(el=>el.setAttribute('aria-expanded','false'))}
    this.tableTools.onkeydown=event=>{if(event.key==='Escape'&&!this.tableMenu.hidden){event.preventDefault();event.stopPropagation();closeTableMenu();more.focus()}}
    this.dom.addEventListener('mousedown',event=>{if(!this.tableTools.contains(event.target as globalThis.Node))closeTableMenu()})

    // Input Rules
    const rules = inputRules({
      rules: [
        textblockTypeInputRule(/^(#{1,6})\s$/, s.nodes.heading, match => ({ level: match[1].length })),
        textblockTypeInputRule(/^```([^`\s]*)\s$/, s.nodes.code_block, match => ({ params: match[1] })),
        wrappingInputRule(/^\s*>\s$/, s.nodes.blockquote),
        wrappingInputRule(/^\s*([-+*])\s$/, s.nodes.bullet_list),
        wrappingInputRule(/^(\d+)\.\s$/, s.nodes.ordered_list, match => ({ order: +match[1] })),
        new InputRule(/^\[([ xX])\] $/, (state, match, start, end) => {
          const $from = state.doc.resolve(start)
          for (let depth = $from.depth; depth > 0; depth--) {
            if ($from.node(depth).type === s.nodes.list_item) {
              return state.tr
                .delete(start, end)
                .setNodeMarkup($from.before(depth), undefined, {
                  ...$from.node(depth).attrs,
                  checked: match[1] !== ' ',
                })
            }
          }
          return null
        }),
      ],
    })

    // Create ProseMirror EditorView
    this.view = new EditorView(mount, {
      state: EditorState.create({
        schema: s,
        doc: this.bridge.doc,
        plugins: [
          new Plugin({
            appendTransaction: (_transactions, _before, state) => {
              const seen = new Set<string>()
              const tr = state.tr
              state.doc.forEach((node, pos) => {
                const id = node.attrs.sourceId as string
                if (!id || seen.has(id)) {
                  tr.setNodeMarkup(pos, undefined, { ...node.attrs, sourceId: `live-${++nodeIdentity}` })
                } else {
                  seen.add(id)
                }
              })
              return tr.steps.length ? tr : null
            },
          }),
          rules,
          createLiveSearchPlugin(),
          createNodeTargetPlugin(),
          new Plugin({ props: { decorations: state => {
            const decorations = this.inlineSource?.decorations(state.doc).find() || []
            const { $from } = state.selection
            if(isInTable(state)) {
              for(let depth=$from.depth;depth>0;depth--)if($from.node(depth).type===s.nodes.table){
                decorations.push(Decoration.widget($from.before(depth),this.tableTools,{key:'active-table-tools',side:-1,stopEvent:()=>true,ignoreSelection:true}));break
              }
            }
            if ($from.parent.type === s.nodes.heading) {
              const pos = $from.before()
              decorations.push(Decoration.node(pos, pos + $from.parent.nodeSize, { class: 'md-heading-focused', 'data-heading-level': `h${$from.parent.attrs.level}` }))
            }
            return DecorationSet.create(state.doc, decorations)
          } } }),
          keymap({
            'Mod-z': () => { options.history(false); return true },
            'Mod-y': () => { options.history(true); return true },
            'Mod-Shift-z': () => { options.history(true); return true },
            'Mod-f': () => { this.find(false); return true },
            'Mod-r': () => { this.find(true); return true },
            'F3': () => { this.findNext(); return true },
            'Shift-F3': () => { this.findPrevious(); return true },
            'Mod-b': toggleMark(s.marks.strong),
            'Mod-i': toggleMark(s.marks.em),
            'Mod-Shift-x': toggleMark(s.marks.strike),
            'Mod-`': toggleMark(s.marks.code),
            'Backspace': (state, dispatch) => {
              const {empty,$from}=state.selection
              if(!empty || $from.parent.type!==s.nodes.heading || $from.parentOffset!==0)return false
              dispatch?.(state.tr.setNodeMarkup($from.before(),s.nodes.paragraph,{sourceId:$from.parent.attrs.sourceId}).setMeta('isolated',true).scrollIntoView())
              return true
            },
            'Enter': chainCommands(this.enterFence,splitListItem(s.nodes.list_item, { checked: null }), liftEmptyBlock, baseKeymap.Enter),
            'Tab': chainCommands(this.nextCell(1), sinkListItem(s.nodes.list_item)),
            'Shift-Tab': chainCommands(this.nextCell(-1), liftListItem(s.nodes.list_item)),
            'Shift-Enter': (state, dispatch) => {
              dispatch?.(state.tr.replaceSelectionWith(s.nodes.hard_break.create()).scrollIntoView())
              return true
            },
            'Mod-Enter': exitCode,
            'Escape': () => {
              if (!this.properties.hidden) {
                this.properties.hidden = true
                return true
              }
              if (this.searchController.isOpen) {
                this.searchController.close()
                return true
              }
              return false
            },
            ...Object.fromEntries(
              [1, 2, 3, 4, 5, 6].map(level => [`Mod-Alt-${level}`, setBlockType(s.nodes.heading, { level })])
            ),
          }),
          keymap(baseKeymap),
          gapCursor(),
          new Plugin({
            props: {
              handleKeyDown: (_view, event) => {
                if (this.fenceAutocomplete?.handleKeyDown(event)) {
                  return true
                }
                return false
              },
              handleDOMEvents: {
                focus: () => { options.focus(); return false },
                beforeinput: (_view, event) => {
                  const e = event as InputEvent
                  if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
                    e.preventDefault()
                    options.history(e.inputType === 'historyRedo')
                    return true
                  }
                  return false
                },
                contextmenu: (view, event) => {
                  const image = (event.target as Element).closest('.md-live-image')
                  const link = (event.target as Element).closest('a')
                  if (image) {
                    const pos = view.posAtDOM(image, 0)
                    const node = view.state.doc.nodeAt(pos)
                    if (node?.type === s.nodes.image) {
                      event.preventDefault(); this.closeInline(); this.imageProperties(image as HTMLElement, node, pos); return true
                    }
                  }
                  if (link) {
                    event.preventDefault(); this.closeInline(); this.linkProperties(link as HTMLElement, link.getAttribute('data-href') || ''); return true
                  }
                  if (!(event.target as Element).closest('td,th')) return false
                  const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
                  if (pos) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos.pos))))
                  event.preventDefault()
                  this.updateTools()
                  this.tableTools.querySelector('button')?.focus()
                  return true
                },
              },
              handleClick: (view, _pos, event) => {
                const a = (event.target as Element).closest('a')
                if (!a) {
                  // Click outside popover closes it
                  if (!this.properties.hidden && !(event.target as Element).closest('.md-properties')) {
                    this.properties.hidden = true
                  }
                  return this.activateMark(view,event)
                }
                return this.activateLink(view,event)
              },
              handleDoubleClick: (view,_pos,event) => this.activateLink(view,event) || this.activateMark(view,event),
              handleTripleClick: (view,_pos,event) => this.activateLink(view,event) || this.activateMark(view,event),
              transformPastedHTML: html => {
                const doc = new DOMParser().parseFromString(html, 'text/html')
                doc.querySelectorAll('script,style,iframe,object,embed,svg,math').forEach(el => el.remove())
                for (const el of doc.body.querySelectorAll('*')) {
                  for (const attr of [...el.attributes]) {
                    if (
                      attr.name.startsWith('on') ||
                      ['style', 'src', 'srcset'].includes(attr.name) ||
                      (attr.name === 'href' && !safeMarkdownURL(attr.value) && !attr.value.startsWith('#'))
                    ) {
                      el.removeAttribute(attr.name)
                    }
                  }
                }
                return doc.body.innerHTML
              },
            },
          }),
          tableEditing(),
        ],
      }),
      nodeViews: {
        code_block: (node, view, getPos) => {
          const code = new CodeBlockView(
            node,
            view,
            getPos,
            this.settings,
            options.history,
            replace => this.find(replace),
            forward => forward ? this.findNext() : this.findPrevious()
          )
          this.codeViews.add(code)
          const destroy = code.destroy.bind(code)
          code.destroy = () => {
            this.codeViews.delete(code)
            destroy()
          }
          return code
        },
        html_block: (node, view, getPos) => new HtmlBlockView(node, view, getPos, this.options.resources, this.options.history),
        html_inline: (node, view, getPos) => new HtmlInlineView(node, view, getPos, this.options.resources),
        protected_source: (node, view, getPos) => {
          const source = String(node.attrs.source || '').trim()
          if (/^\$\$[\s\S]*\$\$$/.test(source)) {
            return this.mathView(node, view, getPos, true)
          }
          if (node.attrs.label === 'HTML（安全源码）' || /^\s*<[a-zA-Z][\s\S]*>/m.test(source)) {
            return new HtmlBlockView(node, view, getPos, this.options.resources, this.options.history)
          }
          return this.protectedView(node, view, getPos)
        },
        image: (node, view, getPos) => {
          const imgView = new LiveImageView(
            node,
            view,
            getPos,
            this.options.resources,
            (_imgEl, _n, pos) => { this.properties.hidden = true; this.openInlineAt(pos, 'image') },
            (imgEl, node, pos) => { this.closeInline(); this.imageProperties(imgEl, node, pos) },
            (image, current) => this.imagePreview.open(image, current)
          )
          this.liveImages.add(imgView)
          const destroy = imgView.destroy.bind(imgView)
          imgView.destroy = () => {
            this.liveImages.delete(imgView)
            destroy()
          }
          return imgView
        },
        math_inline: (node, view, getPos) => this.mathView(node, view, getPos),
        footnote_reference: (node, view) => {
          const dom = document.createElement('sup')
          dom.className = 'md-footnote'
          dom.contentEditable = 'false'
          dom.textContent = node.attrs.label
          dom.title = '查看脚注'
          dom.onclick = () => {
            view.state.doc.forEach((block, pos) => {
              if (block.type === s.nodes.protected_source && String(block.attrs.source).includes(`[^${node.attrs.label}]:`)) {
                view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)).scrollIntoView())
                const target = this.dom.querySelectorAll<HTMLDetailsElement>('.md-protected')
                for (const item of target) if (item.textContent?.includes(`[^${node.attrs.label}]`)) item.open = true
              }
            })
          }
          return { dom, stopEvent: () => true }
        },
        list_item: (node, view, getPos) => this.listView(node, view, getPos),
      },
      attributes: { class: 'md-prose', spellcheck: 'false', 'aria-label': 'Markdown 正文' },
      editable: () => !options.readOnly?.(),
      dispatchTransaction: tr => this.dispatch(tr),
    })

    // Live Search Controller
    this.searchController = new LiveSearchController(this.view, this.dom, () => this.codeViews)

    // Listeners
    this.dom.addEventListener('compositionend', this.onCompositionEnd)
    this.dom.addEventListener('compositionstart', this.onCompositionStart, true)
    this.dom.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        if (event.key.toLowerCase() === 'f') {
          event.preventDefault()
          this.find(false)
        } else if (event.key.toLowerCase() === 'r') {
          event.preventDefault()
          this.find(true)
        }
      }
    })
    this.dom.addEventListener('scroll', () => {
      if (this.currentAnchorEl && !this.properties.hidden) {
        this.positionAnchoredElement(this.properties, this.currentAnchorEl)
      }
    })

    this.typography(options.typography)
    this.reveal(options.head)
    this.updateTools()
  }

  private enterFence: Command = (state, dispatch) => {
    const { empty, $from } = state.selection
    if (!empty || $from.parent.type !== s.nodes.paragraph || $from.parentOffset !== $from.parent.content.size) return false
    const fence = /^(`{3,}|~{3,})([^`~\s]*)[ \t]*$/.exec($from.parent.textContent)
    if (!fence) return false
    this.fenceAutocomplete?.hide()
    const pos = $from.before()
    const tr = state.tr
      .delete($from.start(), $from.end())
      .setNodeMarkup(pos, s.nodes.code_block, {
        sourceId: $from.parent.attrs.sourceId,
        params: fence[2] || '',
        fence: fence[1] || '```',
      })
    dispatch?.(tr.setSelection(TextSelection.create(tr.doc, pos + 1)).setMeta('isolated', true).scrollIntoView())
    queueMicrotask(() => {
      if (!this.disposed) {
        const code = [...this.codeViews].find(c => c.getPos() === pos)
        if (code) {
          code.cm.focus()
          code.setSelection(0, 0)
        }
      }
    })
    return true
  }

  private commitFence(language: string, fenceMarks: string) {
    const { state } = this.view
    const { selection } = state
    const { $from } = selection
    if ($from.parent.type !== s.nodes.paragraph) return
    this.fenceAutocomplete?.hide()
    const pos = $from.before()
    const tr = state.tr
      .delete($from.start(), $from.end())
      .setNodeMarkup(pos, s.nodes.code_block, {
        sourceId: $from.parent.attrs.sourceId,
        params: language || '',
        fence: fenceMarks || '```',
      })
      .setSelection(TextSelection.create(state.doc, pos + 1))
      .setMeta('isolated', true)
      .scrollIntoView()

    this.view.dispatch(tr)
    queueMicrotask(() => {
      if (!this.disposed) {
        const code = [...this.codeViews].find(c => c.getPos() === pos)
        if (code) {
          code.cm.focus()
          code.setSelection(0, 0)
        }
      }
    })
  }

  private tabCompleteFence(language: string, fenceMarks: string) {
    const { state } = this.view
    const { selection } = state
    const { $from } = selection
    if ($from.parent.type !== s.nodes.paragraph) return
    const newText = fenceMarks + language
    const tr = state.tr
      .replaceWith($from.start(), $from.end(), state.schema.text(newText))
      .scrollIntoView()
    this.view.dispatch(tr)
  }

  private updateFenceAutocomplete() {
    if (this.disposed || !this.fenceAutocomplete || this.compositionActive || this.view.composing) {
      this.fenceAutocomplete?.hide()
      return
    }

    const { state } = this.view
    const { selection } = state
    if (!selection.empty) {
      this.fenceAutocomplete.hide()
      return
    }

    const { $from } = selection
    if ($from.parent.type !== s.nodes.paragraph || $from.parentOffset !== $from.parent.content.size) {
      this.fenceAutocomplete.hide()
      return
    }

    const text = $from.parent.textContent
    const match = /^(`{3,}|~{3,})([a-zA-Z0-9_+#.-]*)$/.exec(text)
    if (!match) {
      this.fenceAutocomplete.hide()
      return
    }

    const fence = match[1]
    const query = match[2]
    const pos = $from.pos
    try {
      const coords = this.view.coordsAtPos(pos)
      this.fenceAutocomplete.show(coords, query, fence, {
        onCommit: (lang, f) => this.commitFence(lang, f),
        onTabComplete: (lang, f) => this.tabCompleteFence(lang, f),
      })
    } catch {
      this.fenceAutocomplete.hide()
    }
  }

  get composing() {
    return this.compositionActive || this.view.composing || !!this.inlineSource?.composing || !!this.inlineSource?.pending || [...this.codeViews].some(code => code.cm.compositionStarted)
  }

  get selection() {
    const sel = this.view.state.selection
    return { anchor: this.bridge.sourcePosition(sel.anchor), head: this.bridge.sourcePosition(sel.head) }
  }

  private dispatch(tr: Transaction) {
    if (this.disposed) return
    try {
      const applied = this.view.state.applyTransaction(tr)
      const before = this.bridge.source
      if (applied.state.doc.eq(this.view.state.doc) && !tr.getMeta('inlineSourcePatch')) {
        this.view.updateState(applied.state)
        this.updateTools()
        this.updateSelectionBubble()
        const sel = this.selection
        this.options.selected(sel.anchor, sel.head)
        this.scheduleInlineEntry()
        this.updateFenceAutocomplete()
        return
      }
      const prepared = this.bridge.prepare(applied.state.doc, tr.getMeta('inlineSourcePatch') as SourcePatch | undefined)
      const previous = { source: this.bridge.source, doc: this.bridge.doc, blocks: this.bridge.blocks, environment:this.bridge.environment }
      prepared.commit()
      const update: LiveUpdate = { bridge: this.bridge, transactions: applied.transactions }
      if (prepared.patch && !this.options.publish(before, prepared.patch, update, !!tr.getMeta('isolated'))) {
        Object.assign(this.bridge, previous)
        this.view.updateState(this.view.state)
        notice('文档版本已变化或为只读；已拒绝 Markdown 修改。')
        return
      }
      for (const transaction of applied.transactions) this.inlineSource?.map(transaction)
      this.inlineSource?.mapSource(prepared.patch, tr.getMeta('inlineSourceEditor') === this.inlineSource)
      this.view.updateState(applied.state)
      this.updateTools()
      this.updateSelectionBubble()
      const sel = this.selection
      this.options.selected(sel.anchor, sel.head)
      this.updateFenceAutocomplete()
    } catch (error) {
      notice(`Markdown 修改未应用：${String(error)}`)
    }
  }

  sync(source: string, update?: unknown) {
    if (this.disposed || source === this.bridge.source) return
    if (this.composing) {
      this.pendingSource = source
      return
    }
    const remote = update as LiveUpdate | undefined
    this.inlineSource?.mapSource(textPatch(this.bridge.source, source))
    if (remote && remote.transactions[0]?.before.eq(this.view.state.doc)) {
      let state = this.view.state
      for (const transaction of remote.transactions) {
        const tr = state.tr
        for (const step of transaction.steps) tr.step(step)
        this.inlineSource?.map(tr)
        state = state.apply(tr)
      }
      this.bridge = new MarkdownSourceBridge('')
      Object.assign(this.bridge, { source, doc: remote.bridge.doc, blocks: remote.bridge.blocks, tail: remote.bridge.tail, environment:remote.bridge.environment })
      this.view.updateState(state)
    } else {
      const sel = this.selection
      const bridge = new MarkdownSourceBridge(source)
      const state = this.view.state
      const start = state.doc.content.findDiffStart(bridge.doc.content)
      const end = state.doc.content.findDiffEnd(bridge.doc.content)
      let tr = state.tr
      if (start !== null && end) {
        const overlap = start - Math.min(end.a, end.b)
        tr = tr.replace(start, end.a + Math.max(0, overlap), bridge.doc.slice(start, end.b + Math.max(0, overlap)))
      }
      this.bridge = bridge
      if (!tr.doc.eq(bridge.doc)) tr = state.tr.replaceWith(0, state.doc.content.size, bridge.doc.content)
      const head = Math.min(tr.doc.content.size, bridge.documentPosition(sel.head))
      tr.setSelection(Selection.near(tr.doc.resolve(head)))
      this.inlineSource?.map(tr)
      this.view.updateState(state.apply(tr))
    }
    this.updateTools()
    this.updateSelectionBubble()
  }

  focus() {
    this.view.focus()
  }

  reveal(position: number) {
    const at = Math.min(this.view.state.doc.content.size, this.bridge.documentPosition(position))
    this.view.dispatch(this.view.state.tr.setSelection(Selection.near(this.view.state.doc.resolve(at))).scrollIntoView())
  }

  typography(settings: MarkdownTypography) {
    this.settings = settings
    const style = this.dom.style
    style.setProperty('--md-content-width', `${settings.width}px`)
    style.setProperty('--md-font-size', `${settings.fontSize}px`)
    style.setProperty('--md-line-height', String(settings.lineHeight))
    style.setProperty(
      '--md-font-family',
      settings.fontFamily === 'system'
        ? '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", system-ui, sans-serif'
        : settings.fontFamily === 'serif'
        ? 'Georgia, "Noto Serif CJK SC", "SimSun", serif'
        : '"JetBrains Mono", "Cascadia Code", Consolas, monospace'
    )
    for (const code of this.codeViews) code.typography(settings)
  }

  private run(command: Command, isolated = false) {
    const result = command(
      this.view.state,
      tr => this.view.dispatch(isolated ? tr.setMeta('isolated', true) : tr),
      this.view
    )
    this.view.focus()
    return result
  }

  format(format: MarkdownFormat): boolean {
    const marks = { bold: 'strong', italic: 'em', strike: 'strike', 'inline-code': 'code' } as const
    if (format in marks) return this.run(toggleMark(s.marks[marks[format as keyof typeof marks]]), true)
    if (format.startsWith('heading-')) return this.run(setBlockType(s.nodes.heading, { level: +format.slice(-1) }), true)
    if (format === 'quote') return this.run(wrapIn(s.nodes.blockquote), true)
    if (format === 'bullet' || format === 'task' || format === 'ordered') {
      const result = this.run(wrapInList(format === 'ordered' ? s.nodes.ordered_list : s.nodes.bullet_list), true)
      if (format === 'task') {
        this.view.state.doc.nodesBetween(this.view.state.selection.from, this.view.state.selection.to, (node, pos) => {
          if (node.type === s.nodes.list_item) {
            this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false }))
          }
        })
      }
      return result
    }
    if (format === 'code-block') return this.run(setBlockType(s.nodes.code_block), true)
    if (format === 'table') {
      const cell = (header: boolean) => (header ? s.nodes.table_header : s.nodes.table_cell).createAndFill()!
      const table = s.nodes.table.create(null, [
        s.nodes.table_row.create(null, [cell(true), cell(true)]),
        s.nodes.table_row.create(null, [cell(false), cell(false)]),
      ])
      this.view.dispatch(this.view.state.tr.replaceSelectionWith(table).setMeta('isolated', true))
      return true
    }
    if (format === 'rule') {
      this.view.dispatch(this.view.state.tr.replaceSelectionWith(s.nodes.horizontal_rule.create()).setMeta('isolated', true))
      return true
    }
    if (format === 'link') {
      const sel = this.view.state.selection
      const mark = s.marks.link.create({ href: 'https://' })
      if (!sel.empty) {
        this.view.dispatch(this.view.state.tr.addMark(sel.from, sel.to, mark).setMeta('isolated', true))
      } else {
        this.view.dispatch(this.view.state.tr.replaceSelectionWith(s.text('链接', [mark])).setMeta('isolated', true))
      }
      return true
    }
    if (format === 'image') {
      this.view.dispatch(this.view.state.tr.replaceSelectionWith(s.nodes.image.create({ src: '', alt: '' })).setMeta('isolated', true))
      return true
    }
    return false
  }

  // Live Search actions
  find(replace = false) {
    this.searchController.open(replace)
  }

  findNext() {
    this.searchController.findNext()
  }

  findPrevious() {
    this.searchController.findPrevious()
  }

  closeSearch() {
    this.searchController.close()
  }

  private nextCell(direction: 1 | -1): Command {
    return (state, dispatch, view) => {
      if (!isInTable(state)) return false
      if (goToNextCell(direction)(state, dispatch, view)) return true
      if (direction > 0) {
        return addRowAfter(state, tr => {
          dispatch?.(tr)
          goToNextCell(1)(this.view.state, dispatch, view)
        })
      }
      return false
    }
  }

  private align(value: string): Command {
    return (state, dispatch) => {
      if (!isInTable(state)) return false
      const rect = selectedRect(state)
      const tr = state.tr
      for (let row = 0; row < rect.map.height; row++) {
        const pos = rect.tableStart + rect.map.positionAt(row, rect.left, rect.table)
        tr.setNodeMarkup(pos, undefined, { ...tr.doc.nodeAt(pos)!.attrs, align: value })
      }
      dispatch?.(tr)
      return true
    }
  }

  private positionAnchoredElement(el: HTMLElement, anchor: HTMLElement, placeAbove = false) {
    const containerRect = this.dom.getBoundingClientRect()
    const anchorRect = anchor.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()

    let top = placeAbove
      ? anchorRect.top - containerRect.top + this.dom.scrollTop - (elRect.height || 36) - 8
      : anchorRect.bottom - containerRect.top + this.dom.scrollTop + 8

    if (top < this.dom.scrollTop + 8) {
      top = anchorRect.bottom - containerRect.top + this.dom.scrollTop + 8
    }

    let left = anchorRect.left - containerRect.left + this.dom.scrollLeft
    const maxLeft = this.dom.clientWidth - (elRect.width || 320) - 16
    left = Math.max(16, Math.min(maxLeft, left))

    el.style.position = 'absolute'
    el.style.top = `${top}px`
    el.style.left = `${left}px`
    el.style.zIndex = '25'
  }

  private updateTools() {
    this.imagePreview?.refresh()
    for(const image of this.liveImages)image.refreshLayout()
    if (this.propertyTargetToken && nodeTargetKey.getState(this.view.state)?.token !== this.propertyTargetToken) {
      this.properties.hidden = true
      this.propertyTargetToken = null
    }
    if (this.propertyTargetToken && !this.properties.hidden && this.currentAnchorEl?.isConnected) {
      this.positionAnchoredElement(this.properties, this.currentAnchorEl)
    }
    this.searchController?.updateCount()
    const inTable = isInTable(this.view.state)
    this.tableTools.hidden = !inTable
    if (!inTable) { this.tableMenu.hidden=true;this.tableTools.querySelectorAll('[aria-expanded]').forEach(el=>el.setAttribute('aria-expanded','false')) }
    const { $from }=this.view.state.selection
    let alignment: string | null=null
    for(let depth=$from.depth;depth>0;depth--)if(['table_cell','table_header'].includes($from.node(depth).type.name)){alignment=$from.node(depth).attrs.align || 'left';break}
    this.tableTools.querySelectorAll<HTMLButtonElement>('[data-align]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.align===alignment)))
    for (const refresh of this.extensionViews) refresh()
  }

  private closeInline(focus = false, position?: number) {
    const editor = this.inlineSource
    if (!editor) return
    this.dismissedInline = { from: editor.from, to: editor.to }
    this.inlineSource = null
    // Let the current input handler finish before removing its editing DOM.
    queueMicrotask(() => {
      if(this.inlineSource && this.inlineSource!==editor){editor.destroy();return}
      // A blur may run before PM receives the browser's selectionchange. Keep
      // the new DOM caret instead of restoring the old image/link selection.
      let nextSelection: Selection | undefined
      const native = document.getSelection()
      if (!focus && native?.anchorNode && native.focusNode && this.view.dom.contains(native.anchorNode) && this.view.dom.contains(native.focusNode) && !editor.dom.contains(native.anchorNode)) {
        try {
          nextSelection=TextSelection.create(this.view.state.doc,this.view.posAtDOM(native.anchorNode,native.anchorOffset),this.view.posAtDOM(native.focusNode,native.focusOffset))
        } catch { /* Detached DOM selection: keep PM's current selection. */ }
      }
      editor.destroy()
      if (!this.disposed) {
        if (this.pendingSource !== null) { const source=this.pendingSource; this.pendingSource=null; this.sync(source) }
        if (focus) nextSelection=Selection.near(this.view.state.doc.resolve(Math.min(position ?? editor.to,this.view.state.doc.content.size)))
        if(nextSelection && nextSelection.$from.doc===this.view.state.doc)this.view.dispatch(this.view.state.tr.setSelection(nextSelection))
        else this.view.updateState(this.view.state)
        if (focus) this.view.focus()
      }
    })
  }

  private activateLink(view:EditorView,event:MouseEvent) {
    const a=(event.target as Element).closest('a')
    if(!a)return false
    event.preventDefault()
    if(event.ctrlKey||event.metaKey)this.openLink(a.getAttribute('data-href')||'')
    else{
      const start=view.posAtDOM(a,0)
      const at=view.posAtCoords({left:event.clientX,top:event.clientY})?.pos ?? start
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,at)))
      this.properties.hidden = true
      this.openInlineAt(at,'link')
    }
    return true
  }

  private activateMark(view:EditorView,event:MouseEvent) {
    const el=(event.target as Element).closest('strong,em,s,code')
    const kind=el && ({STRONG:'strong',EM:'em',S:'strike',CODE:'code'} as Record<string,string>)[el.tagName]
    const pos=kind ? view.posAtCoords({left:event.clientX,top:event.clientY})?.pos : undefined
    if (!kind || pos === undefined || this.options.readOnly?.()) return false
    event.preventDefault(); view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,pos)))
    this.openInlineAt(pos,kind); return true
  }

  private scheduleInlineEntry() {
    queueMicrotask(() => {
      if (this.disposed || this.inlineSource || this.composing || !this.view.hasFocus() || !this.view.state.selection.empty) return
      const pos = this.view.state.selection.from
      if (this.dismissedInline && pos >= this.dismissedInline.from && pos <= this.dismissedInline.to) return
      this.dismissedInline = null
      const marks = this.view.state.storedMarks ?? this.view.state.selection.$from.marks()
      const kind = ['link','code','strong','em','strike'].find(kind => marks.some(mark => mark.type.name === kind))
      if (kind) this.openInlineAt(pos, kind)
    })
  }

  private openInlineAt(pos: number, kind: string) {
    if (this.options.readOnly?.() || this.composing) return
    if (this.inlineSource) { if (this.inlineSource.pending) return; this.closeInline() }
    const doc = this.view.state.doc, $pos = doc.resolve(pos)
    let from = pos, to = pos + 1
    if (kind !== 'image') {
      const mark = $pos.nodeAfter?.marks.find(mark => mark.type.name === kind) || $pos.marks().find(mark => mark.type.name === kind)
      if (!mark) return
      const start = $pos.start()
      const runs: {from:number;to:number}[] = []
      $pos.parent.forEach((node, offset) => { if (mark.isInSet(node.marks)) runs.push({ from:start+offset, to:start+offset+node.nodeSize }) })
      const at = runs.findIndex(run => pos >= run.from && pos <= run.to)
      if (at < 0) return
      from = runs[at].from; to = runs[at].to
      for (let i=at-1;i>=0 && runs[i].to===from;i--) from=runs[i].from
      for (let i=at+1;i<runs.length && runs[i].from===to;i++) to=runs[i].to
    }
    const range = inlineSourceRange(this.bridge, doc, from, to, kind)
    if (!range) return
    const editor = new InlineSourceView(from,to,range.sourceFrom,range.sourceTo,kind,range.raw,range.inherited,doc.slice(from,to).content,()=>this.bridge.environment,range.blockId,
      (editor, raw, content) => {
        if (this.disposed || this.inlineSource !== editor || this.options.readOnly?.()) return false
        const patch: SourcePatch = { from:editor.sourceFrom, to:editor.sourceTo, insert:raw,blockId:editor.blockId }
        this.properties.hidden = true
        const tr = this.view.state.tr.replaceWith(editor.from,editor.to,content)
          .setMeta('inlineSourcePatch',patch).setMeta('inlineSourceEditor',editor)
        const oldTo=editor.to,oldSourceTo=editor.sourceTo
        editor.acceptRange(editor.from+content.size,editor.sourceFrom+raw.length)
        this.view.dispatch(tr)
        const accepted=this.bridge.source.slice(patch.from,patch.from+raw.length)===raw
        if(!accepted)editor.acceptRange(oldTo,oldSourceTo)
        return accepted
      }, (focus, position) => { if (this.inlineSource === editor) this.closeInline(focus, position) }, forward => this.options.history(forward), (command, selection) => {
        if (this.disposed) return
        if (command === 'select-all') { this.view.dispatch(this.view.state.tr.setSelection(new AllSelection(this.view.state.doc))); this.view.focus() }
        else if (command === 'find' || command === 'replace') this.find(command === 'replace')
        else {
          const nearest = (offset: number) => {
            let result=editor.from, distance=Infinity
            for(let pos=editor.from;pos<=editor.to;pos++) {
              const delta=Math.abs(this.bridge.sourcePosition(pos)-editor.sourceFrom-offset)
              if(delta<distance){distance=delta;result=pos}
            }
            return Math.min(result,this.view.state.doc.content.size)
          }
          if(selection)this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc,nearest(selection.anchor),nearest(selection.head))))
          if(command === 'enter') this.run(chainCommands(splitListItem(s.nodes.list_item,{checked:null}),liftEmptyBlock,baseKeymap.Enter),true)
          else if(command === 'hard-break') { this.view.dispatch(this.view.state.tr.replaceSelectionWith(s.nodes.hard_break.create()).setMeta('isolated',true));this.view.focus() }
          else this.format(command)
        }
      })
    this.inlineSource = editor; this.dismissedInline = null
    this.view.updateState(this.view.state)
    editor.focus(Math.max(0, Math.min(range.raw.length, this.bridge.sourcePosition(pos) - range.sourceFrom)))
  }

  private buildSelectionBubble() {
    const actions: [string, () => void][] = [
      ['B', () => this.format('bold')],
      ['I', () => this.format('italic')],
      ['S', () => this.format('strike')],
      ['</>', () => this.format('inline-code')],
      ['🔗', () => this.format('link')],
    ]
    for (const [label, act] of actions) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = label
      btn.onmousedown = e => e.preventDefault()
      btn.onclick = () => {
        act()
        this.view.focus()
      }
      this.selectionBubble.append(btn)
    }
  }

  private updateSelectionBubble() {
    const sel = this.view.state.selection
    if (sel.empty || !(sel instanceof TextSelection)) {
      this.selectionBubble.hidden = true
      return
    }
    const coords = this.view.coordsAtPos(sel.from)
    const containerRect = this.dom.getBoundingClientRect()
    const top = coords.top - containerRect.top + this.dom.scrollTop - 36
    const left = Math.max(16, Math.min(this.dom.clientWidth - 160, coords.left - containerRect.left + this.dom.scrollLeft))
    this.selectionBubble.style.position = 'absolute'
    this.selectionBubble.style.top = `${top}px`
    this.selectionBubble.style.left = `${left}px`
    this.selectionBubble.hidden = false
  }

  private field(label: string, value: string): HTMLInputElement {
    const wrapper = document.createElement('label')
    wrapper.textContent = label
    const input = document.createElement('input')
    input.setAttribute('aria-label', label)
    input.value = value
    wrapper.append(input)
    this.properties.append(wrapper)
    return input
  }

  private propertyButton(label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.onclick = action
    this.properties.append(button)
    return button
  }

  private linkProperties(anchorEl: HTMLElement, href: string) {
    this.propertyTargetToken = null
    this.properties.replaceChildren()
    this.properties.hidden = false
    this.currentAnchorEl = anchorEl

    const selection = this.view.state.selection
    let from = selection.from
    let to = selection.to
    const $pos = this.view.state.doc.resolve(from)
    const link = s.marks.link.isInSet($pos.marks()) || s.marks.link.isInSet($pos.nodeAfter?.marks || [])
    if (link) {
      const parent = $pos.parent
      const start = $pos.start()
      parent.forEach((node, offset) => {
        if (s.marks.link.isInSet(node.marks)?.eq(link) && start + offset <= from && start + offset + node.nodeSize >= from) {
          from = start + offset
          to = from + node.nodeSize
        }
      })
    }

    const textInput = this.field('链接文字', this.view.state.doc.textBetween(from, to))
    const urlInput = this.field('链接 URL', href)

    const expected = this.view.state.doc.slice(from, to).content
    const current = () => to <= this.view.state.doc.content.size && this.view.state.doc.slice(from, to).content.eq(expected)

    this.propertyButton('应用链接', () => {
      if (!current()) {
        notice('链接内容已变化，请重新选择链接。')
        this.properties.hidden = true
        return
      }
      const mark = s.marks.link.create({ href: urlInput.value })
      const tr = this.view.state.tr
      if (textInput.value) {
        tr.replaceWith(from, to, s.text(textInput.value, [mark]))
      } else {
        tr.addMark(from, to, mark)
      }
      this.view.dispatch(tr.setMeta('isolated', true))
      this.properties.hidden = true
      this.focus()
    })

    this.propertyButton('打开链接', () => this.openLink(urlInput.value))
    this.propertyButton('复制链接', () => {
      void textClipboard.writeText(urlInput.value).then(() => {
        notice('链接已复制到剪贴板')
      })
    })
    this.propertyButton('移除链接', () => {
      if (current()) {
        this.view.dispatch(this.view.state.tr.removeMark(from, to, s.marks.link).setMeta('isolated', true))
      }
      this.properties.hidden = true
      this.focus()
    })

    this.positionAnchoredElement(this.properties, anchorEl)
    urlInput.focus()
  }

  private imageProperties(anchorEl: HTMLElement, node: Node, pos: number) {
    const token = this.trackPropertyNode(node, pos)
    this.properties.replaceChildren()
    this.properties.hidden = false
    this.currentAnchorEl = anchorEl

    const altInput = this.field('图片替代文字', node.attrs.alt || '')
    const srcInput = this.field('图片路径', node.attrs.src)

    this.propertyButton('应用图片', () => {
      const target = this.currentPropertyNode(token)
      if (target) {
        this.view.dispatch(
          this.view.state.tr
            .setNodeMarkup(target.pos, undefined, {
              ...target.node.attrs,
              src: srcInput.value,
              alt: altInput.value,
            })
            .setMeta('isolated', true)
        )
      }
      this.properties.hidden = true
    })

    this.propertyButton('删除图片', () => {
      const target = this.currentPropertyNode(token)
      if (target) {
        this.view.dispatch(this.view.state.tr.delete(target.pos, target.pos + target.node.nodeSize).setMeta('isolated', true))
      }
      this.properties.hidden = true
    })

    this.propertyButton('关闭', () => {
      this.properties.hidden = true
    })

    this.positionAnchoredElement(this.properties, anchorEl)
    altInput.focus()
  }

  private trackPropertyNode(node: Node, pos: number) {
    const token = {}
    this.view.dispatch(this.view.state.tr.setMeta(nodeTargetKey, { target: { token, pos, node } }))
    this.propertyTargetToken = token
    return token
  }

  private currentPropertyNode(token: object): NodeTarget | null {
    const target = nodeTargetKey.getState(this.view.state)
    if (this.disposed || this.properties.hidden || this.propertyTargetToken !== token || target?.token !== token || this.view.state.doc.nodeAt(target.pos) !== target.node) {
      notice('目标内容已变化，请重新选择。')
      return null
    }
    return target
  }

  private openLink(href: string) {
    if (href.startsWith('#')) {
      let slug: string
      try {
        slug = decodeURIComponent(href.slice(1))
      } catch {
        return
      }
      let target: number | undefined
      this.view.state.doc.descendants((node, pos) => {
        if (node.type === s.nodes.heading && node.textContent.toLowerCase().replace(/\s+/g, '-') === slug) {
          target = pos + 1
        }
      })
      if (target !== undefined) {
        this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, target)).scrollIntoView())
        this.focus()
      }
      return
    }
    if (safeMarkdownURL(href)) {
      void openMarkdownLink(href)
      return
    }
    if (!/^[/\\]|:|[\0\r\n]/.test(href)) {
      this.options.openRelative?.(href)
      return
    }
    notice('链接协议或路径未获允许。')
  }

  private protectedView(node: Node, view: EditorView, getPos: () => number | undefined): NodeView {
    const dom = document.createElement('div')
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    const input = document.createElement('textarea')
    const preview = document.createElement('div')

    details.className = 'md-protected'
    dom.className = 'md-extension'
    dom.contentEditable = 'false'
    summary.textContent = node.attrs.label
    input.value = node.attrs.source
    input.setAttribute('aria-label', node.attrs.label)
    input.spellcheck = false
    details.append(summary, input)
    dom.append(preview, details)

    let previous = ''
    let knownPreview = false
    const finishSource = () => {
      if (!knownPreview) return
      details.hidden = true; details.open = false; preview.hidden = false
    }
    const editSource = () => {
      if (!knownPreview || this.options.readOnly?.()) return
      details.hidden = false; details.open = true; preview.hidden = true; input.focus()
    }
    const refresh = () => {
      const source = String(node.attrs.source)
      const toc = /^\[toc\]$/i.test(source.trim())
      const key = toc ? view.state.doc.textContent : source
      if (key === previous) return
      previous = key
      preview.replaceChildren()
      knownPreview = toc || /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(source) || /^\s*\[\^/.test(source) || /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)/.test(source)
      if (!details.open) details.hidden = knownPreview
      dom.classList.toggle('md-extension-preview',knownPreview)

      if (toc) {
        summary.textContent = '目录源码'
        preview.className = 'md-toc'
        view.state.doc.descendants((heading, pos) => {
          if (heading.type !== s.nodes.heading) return
          const button = document.createElement('button')
          button.type = 'button'
          button.textContent = heading.textContent
          button.style.paddingLeft = `${(heading.attrs.level - 1) * 28}px`
          if (heading.attrs.level === 1) button.style.fontWeight = '700'
          button.onclick = () => {
            view.dispatch(this.view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)).scrollIntoView())
            view.focus()
          }
          preview.append(button)
        })
      } else if (/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(source)) {
        summary.textContent = 'Callout 源码'
        preview.className = 'md-callout'
        const lines = source.split('\n')
        const title = document.createElement('strong')
        title.textContent = lines[0].replace(/^>\s*\[!|\]$/g, '')
        const body = document.createElement('p')
        body.textContent = lines
          .slice(1)
          .map(line => line.replace(/^>\s?/, ''))
          .join('\n')
        preview.append(title, body)
      } else if (/^\s*\[\^/.test(source)) {
        summary.textContent = '脚注定义源码'
        preview.className = 'md-footnote-definition'
        preview.textContent = source
      } else if (/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)/.test(source)) {
        summary.textContent = '元数据 (YAML Front Matter)'
        preview.className = 'md-yaml-preview'
        preview.textContent = source.replace(/^---\r?\n?|\r?\n?(?:---|\.\.\.)\s*$/g, '').trim()
      }
    }

    refresh()
    this.extensionViews.add(refresh)

    input.oninput = () => {
      const pos = getPos()
      if (pos !== undefined && !this.options.readOnly?.() && view.state.doc.nodeAt(pos) === node) {
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, source: input.value }))
      }
    }
    preview.onclick = event => { if (!(event.target as Element).closest('button')) editSource() }
    preview.oncontextmenu = event => { if (knownPreview) { event.preventDefault(); editSource() } }
    input.onblur = finishSource
    input.onkeydown = event => {
      if (event.isComposing) return
      if ((event.ctrlKey || event.metaKey) && ['z','y'].includes(event.key.toLowerCase())) { event.preventDefault(); this.options.history(event.key.toLowerCase() === 'y' || event.shiftKey) }
      else if(event.key === 'Escape') { event.preventDefault(); finishSource(); view.focus() }
    }

    return {
      dom,
      stopEvent: () => true,
      ignoreMutation: () => true,
      update: next => {
        if (next.type !== node.type) return false
        if (/^\$\$[\s\S]*\$\$$/.test(String(next.attrs.source).trim())) return false
        node = next
        if (input.value !== next.attrs.source) input.value = next.attrs.source
        refresh()
        return true
      },
      destroy: () => {
        input.oninput = null
        this.extensionViews.delete(refresh)
      },
    }
  }

  private mathView(node: Node, view: EditorView, getPos: () => number | undefined, display = false): NodeView {
    const dom = document.createElement(display ? 'div' : 'span')
    dom.className = display ? 'md-math-output' : 'md-inline-math'
    dom.contentEditable = 'false'
    dom.title = '点击编辑公式'
    const preview = document.createElement(display ? 'div' : 'span')
    const input = document.createElement('textarea')
    input.className = 'md-math-source'
    input.setAttribute('aria-label', '公式源码')
    input.spellcheck = false
    input.rows = display ? 3 : 1
    input.hidden = true
    dom.append(input, preview)
    let generation = 0
    let dead = false
    const latex = () => display ? String(node.attrs.source).trim().slice(2, -2).trim() : node.attrs.latex
    const render = () => {
      const request = ++generation
      void import('./renderers').then(renderer => renderer.renderMath(preview, latex(), display, () => !dead && request === generation))
        .catch(error => { if (!dead && request === generation) preview.textContent = `公式无法渲染：${String(error)}` })
    }
    render()
    const finish = () => { input.hidden = true; dom.classList.remove('md-math-editing') }
    input.oninput = () => {
      const pos = getPos()
      if (dead || input.hidden || this.options.readOnly?.() || pos === undefined || view.state.doc.nodeAt(pos) !== node || this.compositionActive) return
      const attrs = display ? { ...node.attrs, source: `$$\n${input.value}\n$$` } : { ...node.attrs, latex: input.value }
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, attrs))
    }
    input.addEventListener('compositionend', () => { queueMicrotask(() => { if (!dead) input.oninput?.(new Event('input')) }) })
    input.onkeydown = event => {
      if (event.isComposing) return
      if ((event.ctrlKey || event.metaKey) && ['f','r'].includes(event.key.toLowerCase())) {
        event.preventDefault(); finish(); this.find(event.key.toLowerCase() === 'r'); return
      }
      if ((event.ctrlKey || event.metaKey) && ['z','y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); this.options.history(event.key.toLowerCase() === 'y' || event.shiftKey); return
      }
      if (event.key === 'Escape' || (event.key === 'Enter' && (!display || event.ctrlKey || event.metaKey))) {
        event.preventDefault(); finish()
        const pos = getPos()
        if (pos !== undefined) { view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(pos + node.nodeSize)))); view.focus() }
      }
    }
    input.onblur = () => { if (!this.compositionActive) finish() }
    preview.onclick = () => {
      const pos = getPos()
      if (dead || this.options.readOnly?.() || pos === undefined || view.state.doc.nodeAt(pos) !== node) return
      this.closeInline(); this.properties.hidden = true
      input.value = latex(); input.hidden = false; dom.classList.add('md-math-editing'); input.focus()
    }

    return {
      dom,
      stopEvent: () => true,
      ignoreMutation: () => true,
      update: next => {
        if (next.type !== node.type) return false
        if (display && !/^\$\$[\s\S]*\$\$$/.test(String(next.attrs.source).trim())) return false
        const previous = latex()
        node = next
        if (input.value !== latex() && !input.hidden) { input.value = latex(); finish() }
        if (latex() !== previous) render()
        return true
      },
      destroy: () => { dead = true; generation++; preview.onclick = null },
    }
  }

  private listView(node: Node, view: EditorView, getPos: () => number | undefined): NodeView {
    const dom = document.createElement('li')
    const contentDOM = document.createElement('div')
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.contentEditable = 'false'
    box.setAttribute('aria-label', '任务完成状态')
    box.checked = !!node.attrs.checked
    box.hidden = node.attrs.checked === null
    dom.className = node.attrs.checked === null ? '' : 'md-task'
    dom.append(box, contentDOM)

    box.onchange = () => {
      const pos = getPos()
      if (pos !== undefined) {
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: box.checked }).setMeta('isolated', true))
      }
      box.checked = !!node.attrs.checked
    }

    return {
      dom,
      contentDOM,
      stopEvent: event => event.target === box,
      update: next => {
        if (next.type !== node.type) return false
        node = next
        box.checked = !!node.attrs.checked
        box.hidden = node.attrs.checked === null
        dom.className = node.attrs.checked === null ? '' : 'md-task'
        return true
      },
      destroy: () => {
        box.onchange = null
      },
    }
  }

  refreshResources() {
    for (const img of this.liveImages) img.refreshResource()
    const readOnly = this.options.readOnly?.() ?? false
    if (readOnly !== this.wasReadOnly) {
      this.wasReadOnly = readOnly
      this.view.setProps({ editable: () => !this.options.readOnly?.() })
    }
  }

  async clipboard(operation: 'copy' | 'cut' | 'paste' | 'select-all') {
    const state = this.view.state
    const { from, to } = state.selection
    if (operation === 'select-all') {
      this.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 0, state.doc.content.size)))
      return
    }
    if (operation === 'paste') {
      const text = await textClipboard.readText()
      if (this.view.state !== state) throw new Error('读取剪贴板期间选区变化，已取消粘贴')
      this.view.dispatch(state.tr.insertText(text).setMeta('isolated', true))
    } else {
      await textClipboard.writeText(state.doc.textBetween(from, to, '\n'))
      if (operation === 'cut' && this.view.state === state) {
        this.view.dispatch(state.tr.deleteSelection().setMeta('isolated', true))
      }
    }
  }

  destroy() {
    this.imagePreview.destroy()
    this.fenceAutocomplete?.destroy()
    this.disposed = true
    this.inlineSource?.destroy()
    this.inlineSource = null
    this.dom.removeEventListener('compositionend', this.onCompositionEnd)
    this.dom.removeEventListener('compositionstart', this.onCompositionStart, true)
    this.searchController.destroy()
    this.view.destroy()
    this.dom.remove()
    this.codeViews.clear()
    this.liveImages.clear()
    this.extensionViews.clear()
  }
}
