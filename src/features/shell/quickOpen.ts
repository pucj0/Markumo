import type { PaletteAction, PaletteSource } from '../../types'

export type QuickOpenMode = 'files' | 'commands' | 'all'

export interface ParsedQuickOpenQuery {
  mode: QuickOpenMode
  text: string
  line: number | null
  column: number | null
  commandMode: boolean
}

export interface HighlightRange {
  start: number
  end: number
}

export interface RankedPaletteItem {
  item: PaletteAction
  score: number
  titleRanges: HighlightRange[]
  detailRanges: HighlightRange[]
}

interface Match {
  kind: 'exact' | 'prefix' | 'word' | 'substring' | 'acronym' | 'fuzzy'
  indices: number[]
}

interface Prepared {
  name: string
  lowerName: string
  stem: string
  lowerStem: string
  path: string
  lowerPath: string
}

const SOURCE_RANK: Record<PaletteSource, number> = { open: 0, recent: 1, workspace: 2, command: 3 }
const KIND_SCORE = { exact: 1, prefix: 0.92, word: 0.84, substring: 0.72, acronym: 0.6, fuzzy: 0.42 } as const
const NAME_BASE = 2400
const PATH_BASE = 1500
const prepared = new WeakMap<PaletteAction, Prepared>()
const SEPARATOR = /[\\/._\-\s]/

function fold(value: string) {
  return value.toLowerCase()
}

function stemOf(name: string) {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(0, index) : name
}

function prepare(item: PaletteAction): Prepared {
  let value = prepared.get(item)
  if (!value) {
    const name = item.fileName || item.title
    const stem = stemOf(name)
    const path = (item.category === 'file' ? item.relativePath || item.detail || item.path || '' : '').replace(/\\/g, '/')
    value = { name, lowerName: fold(name), stem, lowerStem: fold(stem), path, lowerPath: fold(path) }
    prepared.set(item, value)
  }
  return value
}

function ranges(indices: number[]): HighlightRange[] {
  const sorted = [...new Set(indices)].sort((a, b) => a - b)
  const output: HighlightRange[] = []
  for (const index of sorted) {
    const last = output[output.length - 1]
    if (last && index === last.end) last.end++
    else output.push({ start: index, end: index + 1 })
  }
  return output
}

function contiguous(index: number, length: number) {
  return Array.from({ length }, (_, offset) => index + offset)
}

/** First letter of every word segment plus CamelCase boundaries. */
function acronymIndices(text: string): number[] {
  const indices: number[] = []
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (index === 0 || SEPARATOR.test(text[index - 1]) || (/[A-Z]/.test(char) && /[a-z]/.test(text[index - 1] || ''))) indices.push(index)
  }
  return indices
}

function matchText(text: string, lower: string, query: string): Match | null {
  if (!query || !text) return null
  if (lower === query) return { kind: 'exact', indices: contiguous(0, query.length) }
  if (lower.startsWith(query)) return { kind: 'prefix', indices: contiguous(0, query.length) }
  const substring = lower.indexOf(query)
  if (substring >= 0) {
    const before = substring === 0 ? '' : lower[substring - 1]
    return { kind: substring > 0 && SEPARATOR.test(before) ? 'word' : 'substring', indices: contiguous(substring, query.length) }
  }
  const acronym = acronymIndices(text)
  if (acronym.length >= query.length) {
    const picked: number[] = []
    let cursor = 0
    for (const char of query) {
      while (cursor < acronym.length && lower[acronym[cursor]] !== char) cursor++
      if (cursor >= acronym.length) break
      picked.push(acronym[cursor++])
    }
    if (picked.length === query.length) return { kind: 'acronym', indices: picked }
  }
  const picked: number[] = []
  let cursor = 0
  for (const char of query) {
    const found = lower.indexOf(char, cursor)
    if (found < 0) return null
    picked.push(found)
    cursor = found + 1
  }
  return { kind: 'fuzzy', indices: picked }
}

function scoreMatch(match: Match, base: number, queryLength: number) {
  let score = base * KIND_SCORE[match.kind]
  if (match.kind === 'substring') score -= match.indices[0] * 1.5
  if (match.kind === 'fuzzy') {
    const span = match.indices[match.indices.length - 1] - match.indices[0] + 1
    score -= Math.max(0, span - queryLength) * 3
  }
  return Math.max(1, score)
}

function segmentMatch(path: string, lower: string, query: string): Match | null {
  let best: Match | null = null
  const pattern = /[^\\/]+/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(path))) {
    const part = match[0]
    const partLower = lower.slice(match.index, match.index + part.length)
    const candidate = matchText(part, partLower, query)
    if (candidate) {
      const shifted = { ...candidate, indices: candidate.indices.map(index => index + match!.index) }
      if (!best || scoreMatch(shifted, PATH_BASE, query.length) > scoreMatch(best, PATH_BASE, query.length)) best = shifted
    }
  }
  return best
}

function compareText(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0
}

function sourceRank(item: PaletteAction) {
  return SOURCE_RANK[item.source || (item.category === 'file' ? 'workspace' : 'command')] ?? 3
}

function isCommand(item: PaletteAction) {
  return item.category === 'action'
}

function fileKey(item: PaletteAction) {
  const path = item.path || ''
  return path ? path.replace(/\\/g, '/').toLowerCase() : `id:${item.id}`
}

function mergeFileItems(items: PaletteAction[]): PaletteAction[] {
  const merged = new Map<string, PaletteAction>()
  for (const item of items) {
    const key = fileKey(item)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, item)
      continue
    }
    const preferred = sourceRank(item) < sourceRank(existing) ? item : existing
    const other = preferred === item ? existing : item
    merged.set(key, {
      ...preferred,
      relativePath: preferred.relativePath || other.relativePath,
      detail: preferred.relativePath || other.relativePath || preferred.detail,
      priority: Math.max(preferred.priority || 0, other.priority || 0),
    })
  }
  return [...merged.values()]
}

function scoreItem(item: PaletteAction, query: string): Omit<RankedPaletteItem, 'item'> | null {
  const value = prepare(item)
  const title = matchText(value.name, value.lowerName, query)
  const stem = matchText(value.stem, value.lowerStem, query)
  const path = matchText(value.path, value.lowerPath, query)
  const segment = segmentMatch(value.path, value.lowerPath, query)
  const titleScore = title ? scoreMatch(title, NAME_BASE, query.length) : 0
  const stemScore = stem ? scoreMatch(stem, NAME_BASE, query.length) * 0.95 : 0
  const pathScore = path ? scoreMatch(path, PATH_BASE, query.length) : 0
  const segmentScore = segment ? scoreMatch(segment, PATH_BASE, query.length) * 1.06 : 0
  if (!titleScore && !stemScore && !pathScore && !segmentScore) return null
  const nameMatch = stemScore > titleScore ? stem : title
  const pathMatch = segmentScore > pathScore ? segment : path
  const score = Math.max(titleScore, stemScore, pathScore, segmentScore) + (item.priority || 0) * 6
  return {
    score,
    titleRanges: nameMatch ? ranges(nameMatch.indices) : [],
    detailRanges: pathMatch ? ranges(pathMatch.indices) : [],
  }
}

export function parseQuickOpenQuery(raw: string, baseMode: 'action' | 'file' | 'all' = 'file', exactFile = false): ParsedQuickOpenQuery {
  const leading = raw.trimStart()
  const commandMode = leading.startsWith('>')
  if (commandMode) {
    return { mode: 'commands', text: leading.slice(1).trimStart().trimEnd(), line: null, column: null, commandMode: true }
  }
  const mode: QuickOpenMode = baseMode === 'action' ? 'commands' : baseMode === 'file' ? 'files' : 'all'
  const trimmed = raw.trim()
  const lineColumn = /^(.*):(\d+):(\d+)$/.exec(trimmed)
  const lineOnly = lineColumn ? null : /^(.*):(\d+)$/.exec(trimmed)
  const match = lineColumn || lineOnly
  if (match && !exactFile) {
    const base = match[1]
    // A bare Windows drive ("C:") is not a line suffix.
    if (base && !/^[A-Za-z]:$/.test(base)) {
      return {
        mode,
        text: base,
        line: Math.max(1, Number(match[2])),
        column: lineColumn ? Math.max(1, Number(match[3])) : null,
        commandMode: false,
      }
    }
  }
  return { mode, text: trimmed, line: null, column: null, commandMode: false }
}

/**
 * Rank the unified palette pool. Search is synchronous over the cached
 * workspace index, so there is no stale async result that can overwrite a newer
 * query. Callers bound the input index (the workspace gateway caps it at 50k).
 */
export function rankPaletteItems(items: PaletteAction[], parsed: ParsedQuickOpenQuery, limit = 100): RankedPaletteItem[] {
  const files = parsed.mode === 'commands' ? [] : mergeFileItems(items.filter(item => !isCommand(item)))
  const commands = parsed.mode === 'files' ? [] : items.filter(isCommand)
  const query = fold(parsed.text.trim()).replace(/\\/g, '/')
  const pool = [...files, ...commands]
  if (!query) {
    const ordered = pool
      .map((item, order) => ({ item, order, source: sourceRank(item), command: isCommand(item) ? 1 : 0 }))
      .sort((a, b) =>
        (parsed.mode === 'all' ? a.command - b.command : 0) ||
        a.source - b.source ||
        (b.item.priority || 0) - (a.item.priority || 0) ||
        compareText(a.item.title, b.item.title) ||
        compareText(a.item.path || '', b.item.path || '') ||
        a.order - b.order ||
        compareText(a.item.id, b.item.id))
      .slice(0, limit)
    return ordered.map(({ item }) => ({ item, score: 0, titleRanges: [], detailRanges: [] }))
  }
  const ranked: RankedPaletteItem[] = []
  for (const item of pool) {
    const scored = scoreItem(item, query)
    if (scored) ranked.push({ item, ...scored })
  }
  ranked.sort((a, b) =>
    b.score - a.score ||
    sourceRank(a.item) - sourceRank(b.item) ||
    compareText(a.item.title, b.item.title) ||
    compareText(a.item.path || '', b.item.path || '') ||
    compareText(a.item.id, b.item.id))
  return ranked.slice(0, limit)
}

/** Visible text segments for title/path highlighting. */
export function highlightSegments(text: string, ranges: HighlightRange[]): { text: string; match: boolean }[] {
  if (!ranges.length) return text ? [{ text, match: false }] : []
  const output: { text: string; match: boolean }[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) output.push({ text: text.slice(cursor, range.start), match: false })
    output.push({ text: text.slice(range.start, range.end), match: true })
    cursor = range.end
  }
  if (cursor < text.length) output.push({ text: text.slice(cursor), match: false })
  return output
}
