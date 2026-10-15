import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'

export interface LiveSearchMatch {
  from: number
  to: number
  text: string
  codeBlockPos?: number
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
  const { search, caseSensitive, wholeWord, regexp } = options
  if (!search) return null
  try {
    let pattern = search
    if (!regexp) {
      pattern = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
    if (wholeWord) {
      pattern = `(?:^|(?<=[^\\p{L}\\p{N}_]))${pattern}(?=[^\\p{L}\\p{N}_]|$)`
    }
    return new RegExp(pattern, caseSensitive ? 'gu' : 'giu')
  } catch {
    return null
  }
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
      const posMap: number[] = []
      let blockText = ''

      node.forEach((child, offset) => {
        if (child.isText && child.text) {
          const childPos = pos + 1 + offset
          for (let i = 0; i < child.text.length; i++) {
            posMap.push(childPos + i)
          }
          blockText += child.text
        }
      })

      if (blockText.length > 0) {
        regex.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = regex.exec(blockText)) !== null) {
          const matchStart = match.index
          const matchEnd = matchStart + match[0].length
          if (matchStart === matchEnd) {
            regex.lastIndex++
            continue
          }

          if (matchStart < posMap.length && matchEnd <= posMap.length) {
            const from = posMap[matchStart]
            const to = posMap[matchEnd - 1] + 1
            matches.push({
              from,
              to,
              text: match[0],
              codeBlockPos: isCode ? pos : undefined,
            })
          }

          if (matches.length >= maxMatches) break
        }
      }
      return false
    }
    return true
  })

  return { matches, valid: true }
}

export function buildDecorations(doc: PMNode, matches: LiveSearchMatch[], currentIndex: number): DecorationSet {
  if (!matches.length) return DecorationSet.empty
  const decos: Decoration[] = []
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    if (m.from < m.to && m.to <= doc.content.size) {
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
