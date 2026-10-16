import { Fragment, type Mark, type Node as PMNode } from 'prosemirror-model'
import type { Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { parser } from '@lezer/markdown'
import { markdownSyntaxExtensions } from '../semantics'
import { markdownParser } from './MarkdownParser'
import type { MarkdownSourceBridge, SourcePatch } from './MarkdownSourceBridge'

const syntax = parser.configure(markdownSyntaxExtensions)
const syntaxNames: Record<string, string> = { link: 'Link', image: 'Image', strong: 'StrongEmphasis', em: 'Emphasis', strike: 'Strikethrough', code: 'InlineCode' }
export function parseInlineSource(raw: string, inherited: readonly Mark[] = [], environment:Record<string,unknown> = {}): Fragment | null {
  if (raw.length > 8192) return null
  if (!raw) return Fragment.empty
  try {
    const doc = markdownParser.parse(raw, {...environment,references:{...environment.references as object}})
    if (doc.childCount !== 1 || doc.firstChild?.type.name !== 'paragraph') return null
    const nodes: PMNode[] = []
    doc.firstChild.forEach(node => {
      let marks = node.marks
      for (const mark of inherited) marks = mark.addToSet(marks)
      nodes.push(node.mark(marks))
    })
    return Fragment.from(nodes)
  } catch { return null }
}

export function inlineSourceRange(bridge: MarkdownSourceBridge, doc: PMNode, from: number, to: number, kind: string): { raw:string; sourceFrom:number; sourceTo:number; inherited:readonly Mark[];blockId:string } | null {
  const expected = doc.slice(from, to).content
  const inherited = expected.firstChild?.marks.filter(mark => mark.type.name !== kind) || []
  const position = bridge.sourcePosition(from)
  const block = bridge.blocks.find(block => position >= block.from && position <= block.to)
  if (!block || block.raw.length > 32768) return null
  let result: { raw: string; sourceFrom: number; sourceTo: number; inherited: readonly Mark[];blockId:string } | null = null
  syntax.parse(block.raw).iterate({ enter(node) {
    if (result || node.name !== syntaxNames[kind]) return
    const sourceFrom = block.from + node.from, sourceTo = block.from + node.to
    if (position < sourceFrom || position > sourceTo) return
    const raw = block.raw.slice(node.from, node.to)
    if (parseInlineSource(raw, inherited, bridge.environment)?.eq(expected)) result = { raw, sourceFrom, sourceTo, inherited,blockId:block.id }
  } })
  return result
}

let identity = 0
export type InlineCommand = 'select-all' | 'find' | 'replace' | 'enter' | 'hard-break' | 'bold' | 'italic' | 'strike' | 'inline-code'

// A native inline editing surface keeps the browser's text caret and paragraph
// flow. CodeMirror remains the editor for fenced code, not for a word in prose.
export class InlineSourceView {
  readonly dom = document.createElement('span')
  readonly input = document.createElement('span')
  readonly key = `inline-source-${++identity}`
  private dead = false
  private accepted: string
  private expected: Fragment
  private draft: string
  private composingInput = false
  private status = document.createElement('span')
  constructor(
    public from: number, public to: number, public sourceFrom: number, public sourceTo: number,
    readonly kind: string, raw: string, readonly inherited: readonly Mark[], expected: Fragment, environment:()=>Record<string,unknown>,readonly blockId:string,
    private publish: (editor: InlineSourceView, raw: string, content: Fragment) => boolean,
    private close: (focus?: boolean, position?: number) => void, history: (forward: boolean) => void,
    private documentCommand: (command: InlineCommand, selection: {anchor:number;head:number} | null) => void,
  ) {
    this.accepted = this.draft = raw; this.expected = expected
    this.dom.className = `md-local-source md-source-${kind}`
    this.dom.contentEditable = 'false'
    this.input.className = 'md-inline-source-input'
    this.input.contentEditable = 'true'
    this.input.setAttribute('role', 'textbox')
    this.input.setAttribute('aria-label', kind === 'image' ? '图片局部源码' : '行内 Markdown 源码')
    this.input.spellcheck = false
    this.status.className = 'md-inline-source-warning'
    this.status.setAttribute('role','status'); this.status.hidden = true
    this.dom.append(this.input, this.status)
    const accept = () => {
      if (this.dead || this.composing) return
      this.draft = this.input.innerText.replace(/\r\n?/g, '\n')
      const content = parseInlineSource(this.draft, this.inherited, environment())
      if (content && this.publish(this, this.draft, content)) { this.accepted = this.draft; this.expected = content }
      this.dom.classList.toggle('md-local-source-invalid', this.pending)
      this.status.hidden = !this.pending
      this.status.textContent = this.pending ? '此局部修改尚未应用。请修正为行内 Markdown，或按 Esc 取消未应用内容。' : ''
      const selection = this.selection()
      this.paint()
      if (selection) this.select(selection.anchor, selection.head)
    }
    this.input.oninput = accept
    this.input.addEventListener('compositionstart', () => { this.composingInput = true })
    this.input.addEventListener('compositionend', () => { this.composingInput = false; accept() })
    this.input.onbeforeinput = event => {
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
        event.preventDefault(); history(event.inputType === 'historyRedo')
      }
    }
    this.input.onpaste = event => {
      event.preventDefault()
      const selection = this.selection()
      if (!selection) return
      const text = (event.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n')
      this.draft = this.draft.slice(0, Math.min(selection.anchor, selection.head)) + text + this.draft.slice(Math.max(selection.anchor, selection.head))
      this.input.textContent = this.draft
      const at = Math.min(selection.anchor, selection.head) + text.length
      this.select(at, at); accept()
    }
    this.input.onkeydown = event => {
      if (event.isComposing || this.composing) return
      const modifier = event.ctrlKey || event.metaKey
      const command = (name: InlineCommand) => {
        event.preventDefault()
        if (this.pending) return
        const selection = this.selection()
        this.close()
        queueMicrotask(() => this.documentCommand(name, selection))
      }
      if (modifier && ['z','y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); history(event.key.toLowerCase() === 'y' || event.shiftKey); return
      }
      if (modifier && ['a','f','r'].includes(event.key.toLowerCase())) {
        command(event.key.toLowerCase() === 'a' ? 'select-all' : event.key.toLowerCase() === 'f' ? 'find' : 'replace')
        return
      }
      if (modifier && (['b','i','`'].includes(event.key.toLowerCase()) || (event.shiftKey && event.key.toLowerCase() === 'x'))) {
        command(event.key.toLowerCase() === 'b' ? 'bold' : event.key.toLowerCase() === 'i' ? 'italic' : event.key === '`' ? 'inline-code' : 'strike'); return
      }
      if (event.key === 'Enter') { command(event.shiftKey ? 'hard-break' : 'enter'); return }
      if (event.key === 'Escape') {
        event.preventDefault()
        if (this.pending) { this.draft = this.accepted; this.paint() }
        if (!this.pending) this.close(true)
        return
      }
      const sel = this.selection()
      if (!event.shiftKey && sel && sel.anchor === sel.head && !this.pending) {
        if ((event.key === 'ArrowLeft' && sel.head === 0) || (event.key === 'ArrowRight' && sel.head === this.draft.length)) {
          event.preventDefault(); this.close(true, event.key === 'ArrowLeft' ? this.from : this.to)
        }
      }
    }
    this.input.onblur = () => queueMicrotask(() => {
      if (!this.dead && document.activeElement !== this.input && !this.pending && !this.composing) this.close()
    })
    this.paint()
  }
  get pending() { return this.draft !== this.accepted }
  get composing() { return this.composingInput }
  private selection() {
    const selection = document.getSelection()
    if (!selection?.anchorNode || !selection.focusNode || !this.input.contains(selection.anchorNode) || !this.input.contains(selection.focusNode)) return null
    const offset = (node: globalThis.Node, at: number) => {
      const range = document.createRange(); range.selectNodeContents(this.input); range.setEnd(node, at); return range.toString().length
    }
    return { anchor: offset(selection.anchorNode, selection.anchorOffset), head: offset(selection.focusNode, selection.focusOffset) }
  }
  private select(anchor: number, head: number) {
    const point = (at: number): [globalThis.Node, number] => {
      const walker = document.createTreeWalker(this.input, NodeFilter.SHOW_TEXT)
      let node: globalThis.Node | null, remaining = Math.max(0, Math.min(at, this.draft.length))
      while ((node = walker.nextNode())) {
        if (remaining <= (node.textContent?.length || 0)) return [node, remaining]
        remaining -= node.textContent?.length || 0
      }
      return [this.input, this.input.childNodes.length]
    }
    const [a, ao] = point(anchor), [h, ho] = point(head)
    document.getSelection()?.setBaseAndExtent(a, ao, h, ho)
  }
  private paint() {
    const ranges: {from:number;to:number;name:string}[] = []
    const classes: Record<string,string> = { StrongEmphasis:'strong', Emphasis:'em', Strikethrough:'strike', InlineCode:'code', Link:'link', Image:'image', URL:'destination', LinkTitle:'destination' }
    syntax.parse(this.draft).iterate({ enter(node) {
      const name = /Mark$/.test(node.name) ? 'delimiter' : classes[node.name]
      if (name) ranges.push({from:node.from,to:node.to,name})
    } })
    const cuts = [...new Set([0,this.draft.length,...ranges.flatMap(r=>[r.from,r.to])])].sort((a,b)=>a-b)
    const fragment = document.createDocumentFragment()
    for (let i=1;i<cuts.length;i++) {
      const span = document.createElement('span'), from=cuts[i-1], to=cuts[i]
      span.className = ranges.filter(r=>r.from<=from && r.to>=to).map(r=>`md-raw-${r.name}`).join(' ')
      span.textContent = this.draft.slice(from,to); fragment.append(span)
    }
    this.input.replaceChildren(fragment)
  }
  focus(offset = 0) {
    this.input.focus({preventScroll:true})
    if (this.kind === 'image') {
      const end = this.draft.indexOf(']')
      this.select(2, end < 2 ? 2 : end)
    } else this.select(offset, offset)
  }
  decorations(doc: PMNode) {
    if (this.dead || this.to > doc.content.size) return DecorationSet.empty
    const decorations = [Decoration.widget(this.kind === 'image' ? this.from : this.to, this.dom, { key:this.key, side:this.kind === 'image' ? -1 : 1, stopEvent:()=>true, ignoreSelection:true })]
    if (this.kind !== 'image' && this.from < this.to) decorations.push(Decoration.inline(this.from, this.to, { class: 'md-local-source-covered' }))
    return DecorationSet.create(doc, decorations)
  }
  map(tr: Transaction) {
    if (this.dead || !tr.docChanged || tr.getMeta('inlineSourceEditor') === this) return
    const from = tr.mapping.mapResult(this.from, 1), to = tr.mapping.mapResult(this.to, -1)
    if (from.deleted || to.deleted || from.pos > to.pos || !tr.doc.slice(from.pos, to.pos).content.eq(this.expected)) this.close()
    else { this.from = from.pos; this.to = to.pos }
  }
  mapSource(patch: SourcePatch | null, own = false) {
    if (!patch || this.dead || own) return
    if (patch.to <= this.sourceFrom) { const delta = patch.insert.length - (patch.to - patch.from); this.sourceFrom += delta; this.sourceTo += delta }
    else if (patch.from < this.sourceTo) this.close()
  }
  acceptRange(to: number, sourceTo: number) { this.to = to; this.sourceTo = sourceTo }
  destroy() { if (this.dead) return; this.dead = true; this.dom.remove() }
}
