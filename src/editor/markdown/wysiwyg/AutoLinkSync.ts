import { Plugin, type EditorState, type Transaction } from 'prosemirror-state'
import type { Mark, Node as PMNode } from 'prosemirror-model'
import { tokenizer } from './MarkdownParser'
import { markdownSchema as s } from './MarkdownSchema'

export type AutoLinkKind = 'bare' | 'angle'

export interface LinkifiedRange {
  from: number
  to: number
  href: string
  title: string | null
  kind: AutoLinkKind
}

/**
 * Every link Markdown-it would create by itself in `text`, in `text` offsets.
 *
 * This reuses the editor's own tokenizer instead of a second URL regex, so the
 * live document, the split preview and the source highlighter can never
 * disagree about where a URL ends or which query parameters it contains.
 */
export function linkifiedRanges(text: string): LinkifiedRange[] {
  if (!text) return []
  const tokens = tokenizer.parseInline(text, {})
  const children = tokens[0]?.children
  if (!children) return []
  const ranges: LinkifiedRange[] = []
  let cursor = 0
  let index = 0
  while (index < children.length) {
    const token = children[index]
    if (token.type === 'link_open') {
      let label = ''
      let next = index + 1
      while (next < children.length && children[next].type !== 'link_close') {
        label += children[next].type === 'softbreak' ? '\n' : children[next].content
        next++
      }
      const at = label ? text.indexOf(label, cursor) : -1
      if (at < 0) {
        index = next + 1
        continue
      }
      cursor = at + label.length
      // `linkify` is the bare form; `autolink` is `<...>`. An explicit
      // `[text](href)` has its own label and must never be rewritten here.
      const kind: AutoLinkKind | null = token.markup === 'linkify' ? 'bare' : token.markup === 'autolink' ? 'angle' : null
      if (kind) ranges.push({ from: at, to: at + label.length, href: String(token.attrGet('href') ?? label), title: typeof token.attrGet('title') === 'string' ? String(token.attrGet('title')) : null, kind })
      index = next + 1
      continue
    }
    cursor += token.type === 'softbreak' ? 1 : token.content.length
    index++
  }
  return ranges
}

interface Span { from: number; to: number; mark: Mark }

function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.from - b.from)
  const merged: Span[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last && last.to === span.from && last.mark.eq(span.mark)) last.to = span.to
    else merged.push({ ...span })
  }
  return merged
}

/** Ranges inside `block` that a `code` mark already protects from linkifying. */
function codeRanges(block: PMNode): { from: number; to: number }[] {
  const code = s.marks.code
  const ranges: { from: number; to: number }[] = []
  block.descendants((child, pos) => {
    if (!child.isText) return true
    if (code.isInSet(child.marks)) ranges.push({ from: pos, to: pos + child.nodeSize })
    return true
  })
  return ranges
}

function autoLinkSpans(block: PMNode): Span[] {
  const link = s.marks.link
  const spans: Span[] = []
  block.descendants((child, pos) => {
    if (!child.isText) return true
    for (const mark of child.marks) {
      if (mark.type === link && mark.attrs.autolink && mark.attrs.autolink !== 'none') {
        spans.push({ from: pos, to: pos + child.nodeSize, mark })
      }
    }
    return true
  })
  return mergeSpans(spans)
}

/**
 * Re-derives linkify links for one text block and returns the mark fix, or
 * `null` when the block already agrees with the tokenizer.
 *
 * Only links that Markdown-it created by itself are touched: an explicit
 * `[label](href)` keeps both its label and its destination.
 */
export function reconcileBlockLinks(tr: Transaction, blockStart: number, block: PMNode): boolean {
  const text = block.textBetween(0, block.content.size, '\n', '\n')
  const protectedRanges = codeRanges(block)
  const expected = linkifiedRanges(text)
    .filter(range => !protectedRanges.some(code => range.from < code.to && range.to > code.from))

  const current = autoLinkSpans(block)
  const same = current.length === expected.length && current.every((span, index) => {
    const target = expected[index]
    return span.from === target.from && span.to === target.to &&
      span.mark.attrs.href === target.href &&
      (span.mark.attrs.title ?? null) === target.title &&
      span.mark.attrs.autolink === target.kind
  })
  if (same) return false

  // Text offsets are content-relative; a document position needs the block's
  // own opening token, hence the leading +1.
  for (const span of current) {
    tr.removeMark(blockStart + 1 + span.from, blockStart + 1 + span.to, span.mark)
  }
  for (const range of expected) {
    tr.addMark(
      blockStart + 1 + range.from,
      blockStart + 1 + range.to,
      s.marks.link.create({ href: range.href, title: range.title, autolink: range.kind }),
    )
  }
  return true
}

/** Text blocks touched by a transaction, at most one pass per block. */
function changedBlocks(transactions: readonly Transaction[], state: EditorState): number[] {
  const starts = new Set<number>()
  for (const tr of transactions) {
    if (!tr.docChanged) continue
    tr.mapping.maps.forEach(map => {
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        const from = Math.max(0, Math.min(state.doc.content.size, Math.min(newStart, newEnd)))
        const $from = state.doc.resolve(from)
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth)
          if (node.isTextblock) {
            starts.add($from.before(depth))
            break
          }
        }
      })
    })
  }
  return [...starts].sort((a, b) => a - b)
}

/**
 * Keeps bare-URL links in step with their visible text after every edit.
 *
 * ProseMirror deliberately does not extend a link past its edges, and inherited
 * marks keep the *old* `href` when characters are typed inside one. Both would
 * leave the document showing one URL while linking to another, so each changed
 * text block is re-derived from the tokenizer. Only changed blocks are touched
 * and the fix converges in one pass, so no appendTransaction loop is possible.
 */
export function createAutoLinkPlugin(isComposing: () => boolean = () => false) {
  return new Plugin({
    appendTransaction: (transactions, _oldState, state) => {
      if (isComposing()) return null
      if (!transactions.some(tr => tr.docChanged)) return null
      const tr = state.tr
      let changed = false
      for (const start of changedBlocks(transactions, state)) {
        const block = state.doc.nodeAt(start)
        if (!block || !block.isTextblock) continue
        if (reconcileBlockLinks(tr, start, block)) changed = true
      }
      return changed ? tr.setMeta('autolink', true) : null
    },
  })
}
