import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import type { Transaction } from 'prosemirror-state'
import { searchRegex, isWholeWord, expandReplacement } from '../../../core/searchQuery'

export interface LiveSearchMatch {
  from: number
  to: number
  text: string
  codeBlockPos?: number
  result: RegExpExecArray
}

export interface LiveSearchOptions {
  search: string
  replace: string
  caseSensitive: boolean
  wholeWord: boolean
  regexp: boolean
}

export interface LiveSearchState {
  active: boolean
  replaceOpen: boolean
  options: LiveSearchOptions
  matches: LiveSearchMatch[]
  currentIndex: number
  decos: DecorationSet
  valid: boolean
}

export const liveSearchPluginKey = new PluginKey<LiveSearchState>('liveSearch')

export function buildSearchRegex(options: LiveSearchOptions): RegExp | null {
  return searchRegex(options)
}

export function findMatches(doc: PMNode, options: LiveSearchOptions, maxMatches = 1500): { matches: LiveSearchMatch[]; valid: boolean } {
  if (!options.search) {
    return { matches: [], valid: true }
  }
  const regex = buildSearchRegex(options)
  if (!regex) {
    return { matches: [], valid: false }
  }

  const matches: LiveSearchMatch[] = []

  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (matches.length >= maxMatches) return false

    if (node.isTextblock) {
      const isCode = node.type.name === 'code_block'
      // Marks do not interrupt text; atoms and hard breaks do. Never delete an
      // image/formula by matching the text on its two sides as one string.
      const runs: { text: string; from: number }[] = []
      let run: { text: string; from: number } | undefined
      node.forEach((child, offset) => {
        if (!child.isText) { run = undefined; return }
        if (!run) { run = { text: '', from: pos + 1 + offset }; runs.push(run) }
        run.text += child.text
      })
      if (!node.childCount) runs.push({ text: '', from: pos + 1 })
      for (const { text: blockText, from: base } of runs) {
        regex.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = regex.exec(blockText)) !== null) {
          const matchStart = match.index
          const matchEnd = matchStart + match[0].length
          if (matchEnd <= blockText.length && (!options.wholeWord || isWholeWord(blockText, matchStart, matchEnd))) {
            const from = base + matchStart
            const to = base + matchEnd
            matches.push({
              from,
              to,
              text: match[0],
              codeBlockPos: isCode ? pos : undefined,
              result: match,
            })
          }

          if (matches.length >= maxMatches) break
          if (matchStart === matchEnd) {
            const code = blockText.codePointAt(regex.lastIndex)
            regex.lastIndex += code !== undefined && code > 0xffff ? 2 : 1
          }
        }
        if (matches.length >= maxMatches) break
      }
      return false
    }
    return true
  })

  return { matches, valid: true }
}

// Expand against the original regex result, so lookbehind/lookahead, named
// groups, $`, $', $$ and captures keep their original textblock context.
export function replacementText(match: LiveSearchMatch, pattern: string, regexp: boolean) {
  if (!regexp) return pattern
  return expandReplacement(match.result, pattern)
}

// Distribute replacement over the original mark runs. A replacement crossing
// a link/strong boundary must not spread the first mark over the whole match.
export function replaceMatch(tr: Transaction, match: LiveSearchMatch, insert: string) {
  if (match.from === match.to) return insert ? tr.insertText(insert, match.from) : tr
  const runs: { from: number; to: number; node: PMNode }[] = []
  tr.doc.nodesBetween(match.from, match.to, (node, pos) => {
    if (node.isText) runs.push({ from: Math.max(pos, match.from), to: Math.min(pos + node.nodeSize, match.to), node })
  })
  let offset = 0
  const replacements = runs.map((run, index) => {
    let end = index === runs.length - 1 ? insert.length : Math.min(insert.length, offset + run.to - run.from)
    if (end > offset && /[\uD800-\uDBFF]/.test(insert[end - 1])) end++
    const text = insert.slice(offset, end)
    offset = end
    return { ...run, text }
  })
  for (const run of replacements.reverse()) {
    tr.replaceWith(run.from, run.to, run.text ? tr.doc.type.schema.text(run.text, run.node.marks) : [])
  }
  return tr
}

export function buildDecorations(doc: PMNode, matches: LiveSearchMatch[], currentIndex: number): DecorationSet {
  if (!matches.length) return DecorationSet.empty
  const decos: Decoration[] = []
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    if (m.from === m.to && m.to <= doc.content.size) {
      decos.push(Decoration.widget(m.from, () => {
        const marker = document.createElement('span')
        marker.className = `md-search-zero md-search-match${i === currentIndex ? ' md-search-match-current' : ''}`
        marker.setAttribute('aria-hidden', 'true')
        return marker
      }, { side: 1 }))
    } else if (m.from < m.to && m.to <= doc.content.size) {
      decos.push(
        Decoration.inline(m.from, m.to, {
          class: i === currentIndex ? 'md-search-match md-search-match-current' : 'md-search-match',
        })
      )
    }
  }
  return DecorationSet.create(doc, decos)
}

export type LiveSearchAction =
  | { type: 'open'; replace?: boolean }
  | { type: 'close' }
  | { type: 'setOptions'; options: Partial<LiveSearchOptions> }
  | { type: 'setCurrentIndex'; index: number }

export function createLiveSearchPlugin(initialOptions?: Partial<LiveSearchOptions>) {
  const defaultOptions: LiveSearchOptions = {
    search: '',
    replace: '',
    caseSensitive: false,
    wholeWord: false,
    regexp: false,
    ...initialOptions,
  }

  return new Plugin<LiveSearchState>({
    key: liveSearchPluginKey,
    state: {
      init(): LiveSearchState {
        return {
          active: false,
          replaceOpen: false,
          options: defaultOptions,
          matches: [],
          currentIndex: -1,
          decos: DecorationSet.empty,
          valid: true,
        }
      },
      apply(tr, prev, _oldState, newState): LiveSearchState {
        const action = tr.getMeta(liveSearchPluginKey) as LiveSearchAction | undefined

        let active = prev.active
        let replaceOpen = prev.replaceOpen
        let options = prev.options
        let currentIndex = prev.currentIndex

        let needsRecompute = tr.docChanged

        if (action) {
          if (action.type === 'open') {
            active = true
            if (action.replace !== undefined) replaceOpen = action.replace
            needsRecompute = true
          } else if (action.type === 'close') {
            active = false
            return {
              ...prev,
              active: false,
              matches: [],
              currentIndex: -1,
              decos: DecorationSet.empty,
            }
          } else if (action.type === 'setOptions') {
            options = { ...options, ...action.options }
            needsRecompute = true
          } else if (action.type === 'setCurrentIndex') {
            currentIndex = action.index
            return {
              ...prev,
              currentIndex,
              decos: buildDecorations(newState.doc, prev.matches, currentIndex),
            }
          }
        }

        if (!active) {
          return {
            ...prev,
            active,
            replaceOpen,
            options,
            matches: [],
            currentIndex: -1,
            decos: DecorationSet.empty,
          }
        }

        if (needsRecompute) {
          const { matches, valid } = findMatches(newState.doc, options)
          if (!matches.length) {
            currentIndex = -1
          } else if (currentIndex < 0 || currentIndex >= matches.length) {
            // Keep current selection match if close, otherwise first
            const head = newState.selection.head
            let closest = 0
            for (let i = 0; i < matches.length; i++) {
              if (matches[i].from >= head) {
                closest = i
                break
              }
            }
            currentIndex = closest
          }
          const decos = buildDecorations(newState.doc, matches, currentIndex)
          return {
            active,
            replaceOpen,
            options,
            matches,
            currentIndex,
            decos,
            valid,
          }
        }

        return prev
      },
    },
    props: {
      decorations(state) {
        const pluginState = liveSearchPluginKey.getState(state)
        return pluginState?.active ? pluginState.decos : DecorationSet.empty
      },
    },
  })
}
