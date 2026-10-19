import { type Extension, type EditorState, type Range } from '@codemirror/state'
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view'
import { language, StreamLanguage, matchBrackets, syntaxTree, syntaxTreeAvailable, type MatchResult } from '@codemirror/language'
import { NodeProp, type SyntaxNode, type Tree } from '@lezer/common'
import { getStyleTags, tags } from '@lezer/highlight'

export const bracketModes = ['off', 'matching', 'rainbow'] as const
export type BracketMode = typeof bracketModes[number]
export const bracketLimits = Object.freeze({nodes: 6000, marks: 2000, ancestors: 16000, depth: 128, characters: 24000, matchCharacters: 4096, cursors: 64})
const pairs = '()[]{}'
const rainbowColorCount = 8
const opening = (name: string) => name.length === 1 && pairs.indexOf(name) >= 0 && pairs.indexOf(name) % 2 === 0
const closing = (name: string) => name.length === 1 && pairs.indexOf(name) % 2 === 1
const partner = (name: string) => pairs[pairs.indexOf(name) ^ 1]
const literal = (node: SyntaxNode) => getStyleTags(node)?.tags.some(tag => tag.set.some(parent => parent === tags.string || parent === tags.comment || parent === tags.regexp))
const delimiter = (node: SyntaxNode) => node.to - node.from === 1 && (opening(node.name) || closing(node.name))

/** Visit only intersecting children, seeking directly into TreeBuffers. Unlike a
 * full-tree iterate, this walk can stop at a hard node budget. Mounted replacement
 * trees are entered by CM/Lezer; Markdown's overlay fences are resolved below. */
function walk(tree: Tree, offset: number, from: number, to: number, visit: (node: SyntaxNode) => boolean, budget: {nodes: number}) {
  const cursor = tree.cursor()
  for (;;) {
    if (--budget.nodes < 0 || cursor.from + offset >= to) return
    if (cursor.to + offset > from && visit(cursor.node) && cursor.childAfter(Math.max(0, from - offset))) continue
    while (!cursor.nextSibling()) if (!cursor.parent()) return
  }
}

interface Work {nodes: number; ancestors: number; marks: number; truncated: boolean}
export const rainbowBrackets = ViewPlugin.fromClass(class {
  decorations: DecorationSet = Decoration.none
  work: Work = {nodes: 0, ancestors: 0, marks: 0, truncated: false}
  private tree?: Tree
  private depths = new Map<string, number>()
  private paused = false
  constructor(view: EditorView) { this.build(view) }
  update(update: ViewUpdate) {
    if (update.docChanged) this.depths.clear()
    if (update.view.composing) { this.decorations = this.decorations.map(update.changes); this.paused = true; return }
    if (this.paused || update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.build(update.view)
    this.paused = false
  }
  private build(view: EditorView) {
    const tree = syntaxTree(view.state)
    if (tree !== this.tree || this.depths.size > bracketLimits.marks * 2) this.depths.clear()
    this.tree = tree
    const budget: {nodes: number} = {nodes: bracketLimits.nodes}
    const marks: Range<Decoration>[] = [], seen = new Set<number>(), levels = new Map<number, number>()
    let ancestors = bracketLimits.ancestors, characters = bracketLimits.characters
    // Every language gets the same bounded fallback. Syntax delimiters retain
    // their structural depth; tokens without delimiter nodes use a local stack.
    // Embedded grammars and Markdown fences each own a separate stack.
    const lexical = (from: number, to: number) => {
      const low = Math.max(0, from - bracketLimits.matchCharacters)
      const high = Math.min(to, low + characters)
      const source = view.state.sliceDoc(low, high)
      const stacks = new Map<string, {char: string; level: number}[]>()
      let blockedUntil = low
      for (let pos = low; pos < high && marks.length < bracketLimits.marks; pos++) {
        if (--characters < 0 || budget.nodes <= 0 || ancestors <= 0) break
        if (pos < blockedUntil) continue
        const char = source[pos - low], index = pairs.indexOf(char)
        if (index < 0) continue
        budget.nodes--
        const token = tree.resolveInner(pos, 1)
        if (!seen.has(pos) && (literal(token) || token.name === 'JSXText')) { blockedUntil = token.to; continue }
        let scope = token, steps = 0
        while (scope.parent && !scope.type.isTop && scope.name !== 'FencedCode' && scope.name !== 'CodeBlock') {
          if (--ancestors < 0 || ++steps > bracketLimits.depth) break
          scope = scope.parent
        }
        if (ancestors < 0 || steps > bracketLimits.depth) break
        const key = scope.from + ':' + scope.to + ':' + scope.type.id
        let stack = stacks.get(key)
        if (!stack) { stack = []; stacks.set(key, stack) }
        let level: number
        if (index % 2 === 0) {
          if (stack.length >= bracketLimits.depth) break
          level = levels.get(pos) ?? (delimiter(token) ? depth(token, 0) : null) ?? stack.length % rainbowColorCount
          stack.push({char, level})
        } else {
          const open = stack[stack.length - 1]
          if (!open || partner(open.char) !== char) continue
          level = open.level; stack.pop()
        }
        if (pos >= from && !seen.has(pos)) {
          seen.add(pos); levels.set(pos, level)
          marks.push(Decoration.mark({class: 'mk-bracket-' + (level + 1)}).range(pos, pos + 1))
        }
      }
    }
    const depth = (token: SyntaxNode, offset: number) => {
      let node = token.parent, level = 0, steps = 0
      const path: {key: string; own: number}[] = []
      while (node && !node.type.isTop) {
        if (--ancestors < 0 || ++steps > bracketLimits.depth) return null
        const key = `${node.from + offset}:${node.to + offset}:${node.type.id}:${node.name}`
        if (this.depths.has(key)) { level = this.depths.get(key)!; break }
        const first = node.firstChild
        path.push({key, own: first && delimiter(first) && opening(first.name) ? 1 : 0})
        node = node.parent
      }
      for (let i = path.length - 1; i >= 0; i--) { level += path[i].own; this.depths.set(path[i].key, level) }
      return level ? (level - 1) % rainbowColorCount : null
    }
    const collect = (current: Tree, offset: number, from: number, to: number) => {
      walk(current, offset, from, to, node => {
        if (marks.length >= bracketLimits.marks || ancestors <= 0) { budget.nodes = 0; return false }
        if (node.type.isError) return false
        if (node.name === 'CodeText') {
          let inner: SyntaxNode | null = tree.resolveInner(Math.max(from, node.from + offset), 1)
          while (inner && !inner.type.isTop) inner = inner.parent
          if (inner && inner.from >= node.from + offset && inner.to <= node.to + offset && inner.name !== 'Document') collect(inner.toTree(), inner.from, from, to)
          return false
        }
        if (!delimiter(node)) return true
        const start = node.from + offset
        if (start < from || start >= to || seen.has(start) || view.state.sliceDoc(start, start + 1) !== node.name) return false
        // Exact grammar delimiter tokens exclude prose, strings, comments and tags.
        const level = depth(node, offset)
        if (level !== null) { seen.add(start); levels.set(start, level); marks.push(Decoration.mark({class: `mk-bracket-${level + 1}`}).range(start, start + 1)) }
        return false
      }, budget)
    }
    for (const range of view.visibleRanges) {
      const to = Math.min(range.to, range.from + characters)
      if (to <= range.from || budget.nodes <= 0) break
      // Do not force synchronous parsing, or trust an unfinished/skipped fence.
      if (tree.type.isAnonymous || syntaxTreeAvailable(view.state, to)) {
        if (!tree.type.isAnonymous && !(view.state.facet(language) instanceof StreamLanguage)) collect(tree, 0, range.from, to)
        lexical(range.from, to)
      }
    }
    this.decorations = Decoration.set(marks, true)
    this.work = {nodes: bracketLimits.nodes - Math.max(0, budget.nodes), ancestors: bracketLimits.ancestors - Math.max(0, ancestors), marks: marks.length,
      truncated: budget.nodes <= 0 || ancestors <= 0 || characters <= 0 || marks.length >= bracketLimits.marks}
  }
  destroy() { this.depths.clear(); this.tree = undefined; this.decorations = Decoration.none }
}, {decorations: value => value.decorations})

/** CM's native matcher may walk all siblings of a huge block, and its plain-text
 * fallback checks scan distance between lines. Use direct grammar siblings for
 * large containers and an exact character budget for lexical fallbacks. */
function matching(state: EditorState, from: number): MatchResult | null {
  const char = state.sliceDoc(from, from + 1), index = pairs.indexOf(char)
  if (index < 0 || !char) return null
  const tree = syntaxTree(state), token = tree.resolveInner(from, 1)
  if (literal(token)) return null
  if (!tree.type.isAnonymous && !syntaxTreeAvailable(state, from + 1)) return null
  const start = {from, to: from + 1}, dir = index % 2 === 0 ? 1 : -1
  if (delimiter(token) && token.from === from && token.parent) {
    const parent = token.parent, first = parent.firstChild, last = parent.lastChild
    if (parent.to - parent.from <= bracketLimits.matchCharacters && token.type.prop(dir > 0 ? NodeProp.closedBy : NodeProp.openedBy)) {
      const result = matchBrackets(state, dir > 0 ? from : from + 1, dir, {brackets: pairs, maxScanDistance: bracketLimits.matchCharacters})
      return result?.matched || syntaxTreeAvailable(state) ? result : null
    }
    if (first && last && delimiter(first) && opening(first.name) && delimiter(last) && closing(last.name) && partner(first.name) === last.name &&
      (from === first.from || from === last.from)) return {start, end: {from: from === first.from ? last.from : first.from, to: from === first.from ? last.to : first.to}, matched: true}
    return syntaxTreeAvailable(state) ? {start, matched: false} : null
  }
  let scope = token
  let steps = 0
  while (scope.parent && !scope.type.isTop) {
    if (++steps > bracketLimits.depth) return null
    scope = scope.parent
  }
  // Identical token types in two fences/scripts are still different scopes.
  const scopeStart = tree.type.isAnonymous ? 0 : scope.from, scopeEnd = tree.type.isAnonymous ? state.doc.length : scope.to
  const low = Math.max(scopeStart, from - bracketLimits.matchCharacters), high = Math.min(scopeEnd, from + bracketLimits.matchCharacters + 1)
  const text = state.sliceDoc(dir > 0 ? from : low, dir > 0 ? high : from + 1), base = dir > 0 ? from : low
  const stack = [char]
  for (let pos = from + dir; pos >= low && pos < high; pos += dir) {
    const next = text[pos - base], kind = pairs.indexOf(next)
    if (kind < 0) continue
    if (!tree.type.isAnonymous && !syntaxTreeAvailable(state, pos + 1)) return null
    const other = tree.resolveInner(pos, 1)
    if (other.type !== token.type || literal(other)) continue
    if ((kind % 2 === 0) === (dir > 0)) stack.push(next)
    else if (partner(stack[stack.length - 1]) !== next) return {start, end: {from: pos, to: pos + 1}, matched: false}
    else if (stack.pop() && !stack.length) return {start, end: {from: pos, to: pos + 1}, matched: true}
  }
  // At the scan boundary we cannot conclude that a distant partner is missing.
  const complete = tree.type.isAnonymous || syntaxTreeAvailable(state) || !!scope.parent && syntaxTreeAvailable(state, scope.parent.to)
  return complete && (dir > 0 ? high === scopeEnd : low === scopeStart) ? {start, matched: false} : null
}

export const matchingBrackets = ViewPlugin.fromClass(class {
  decorations: DecorationSet = Decoration.none
  private paused = false
  constructor(view: EditorView) { this.build(view) }
  update(update: ViewUpdate) {
    if (update.view.composing) { this.decorations = this.decorations.map(update.changes); this.paused = true; return }
    if (this.paused || update.docChanged || update.selectionSet || update.focusChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.build(update.view)
    this.paused = false
  }
  private build(view: EditorView) {
    if (!view.hasFocus) { this.decorations = Decoration.none; return }
    const marks: Range<Decoration>[] = [], seen = new Set<number>()
    for (const range of view.state.selection.ranges.slice(0, bracketLimits.cursors)) {
      if (!range.empty) continue
      for (const position of [range.head - 1, range.head]) {
        if (position < 0 || position >= view.state.doc.length) continue
        const result = matching(view.state, position)
        if (!result) continue
        for (const span of [result.start, result.end]) if (span && !seen.has(span.from) && view.visibleRanges.some(r => span.from >= r.from && span.to <= r.to)) {
          seen.add(span.from); marks.push(Decoration.mark({class: result.matched ? 'mk-bracket-match' : 'mk-bracket-invalid'}).range(span.from, span.to))
        }
        break
      }
    }
    this.decorations = Decoration.set(marks, true)
  }
  destroy() { this.decorations = Decoration.none }
}, {decorations: value => value.decorations})

/** Removing this extension removes both plugins and their caches. No global DOM
 * observers, timers, widgets, replacement text or selection transactions. */
export function bracketHighlight(mode: BracketMode = 'matching'): Extension {
  return mode === 'off' ? [] : mode === 'rainbow' ? [matchingBrackets, rainbowBrackets] : matchingBrackets
}
