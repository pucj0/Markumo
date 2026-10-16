import { EditorSelection } from '@codemirror/state'
import { isolateHistory } from '@codemirror/commands'
import { SearchQuery, getSearchQuery, findNext } from '@codemirror/search'
import type { EditorView } from '@codemirror/view'

export interface SearchOptions {
  search: string
  replace: string
  regexp: boolean
  caseSensitive: boolean
  wholeWord: boolean
}
export const emptySearchOptions = (): SearchOptions => ({ search: '', replace: '', regexp: false, caseSensitive: false, wholeWord: false })
export function regexError(options: Pick<SearchOptions, 'search' | 'regexp'>): string {
  if (!options.regexp || !options.search) return ''
  try { new RegExp(options.search, 'gmu'); return '' }
  catch (error) { return `正则表达式无效：${error instanceof Error ? error.message : String(error)}` }
}
const wordCharacter = /[\p{L}\p{M}\p{N}_]/u
export function isWholeWord(text: string, from: number, to: number) {
  const before = text.slice(Math.max(0, from - 2), from).match(/.$/u)?.[0] || ''
  const after = Array.from(text.slice(to, to + 2))[0] || ''
  return !(wordCharacter.test(before) && wordCharacter.test(Array.from(text.slice(from, to))[0] || '')) &&
    !(wordCharacter.test(after) && wordCharacter.test(text.slice(from, to).match(/.$/u)?.[0] || ''))
}
export function searchRegex(options: SearchOptions): RegExp | null {
  if (!options.search || regexError(options)) return null
  const pattern = options.regexp ? options.search : options.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(pattern, options.caseSensitive ? 'gmu' : 'gmiu')
}
// Reuse the original match. Re-running the regex on its substring loses
// lookaround context and can accidentally apply the replacement twice.
export function expandReplacement(result: RegExpExecArray, pattern: string) {
  return pattern.replace(/\$(\$|&|`|'|<[^>]*>|\d{1,2})/g, (literal, token: string) => {
    if (token === '$') return '$'
    if (token === '&') return result[0]
    if (token === '`') return result.input.slice(0, result.index)
    if (token === "'") return result.input.slice(result.index + result[0].length)
    if (token.startsWith('<')) return result.groups ? result.groups[token.slice(1, -1)] ?? '' : literal
    const index = Number(token)
    if (index > 0 && index < result.length) return result[index] ?? ''
    const first = Number(token[0])
    if (token.length === 2 && first > 0 && first < result.length) return (result[first] ?? '') + token[1]
    return literal
  })
}
export function createSearchQuery(options: SearchOptions) {
  return new SearchQuery({ ...options, literal: true })
}
export function replaceEditorMatches(view: EditorView, all: boolean) {
  const query = getSearchQuery(view.state)
  if (view.state.readOnly || !query.valid || view.composing) return false
  const cursor = query.getCursor(view.state), changes: { from: number; to: number; insert: string }[] = []
  const selection = view.state.selection.main
  for (let item = cursor.next(); !item.done; item = cursor.next()) {
    const match = item.value
    if (!all && (match.from !== selection.from || match.to !== selection.to)) continue
    const result = 'match' in match ? match.match as RegExpExecArray : undefined
    changes.push({ from: match.from, to: match.to, insert: query.regexp && result ? expandReplacement(result, query.replace) : query.replace })
    if (!all) break
  }
  if (!changes.length) { if (!all) findNext(view); return false }
  const changeSet = view.state.changes(changes)
  view.dispatch({ changes: changeSet, selection: all ? undefined : EditorSelection.cursor(changeSet.mapPos(selection.to, 1)),
    annotations: isolateHistory.of('full'), userEvent: all ? 'input.replace.all' : 'input.replace' })
  if (!all) findNext(view)
  return true
}
