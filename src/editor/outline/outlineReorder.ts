import type { OutlineItem } from './outlineService'

export interface SectionRange {
  from: number
  to: number
  item: OutlineItem
  descendantCount: number
}

/** One minimal edit against the current source text. */
export interface SourceChange {
  from: number
  to: number
  insert: string
}

export interface OutlineMovePlan {
  valid: boolean
  error?: string
  sourceRange: { from: number; to: number }
  /** Insertion point in the *original* source, for reference and selection. */
  targetPos: number
  /** Minimal edits that perform the move; empty when invalid. */
  changes: SourceChange[]
  /** Where the moved heading starts after the edits are applied. */
  newCaretPos: number
}

/** Position of the first newline ending at each line start, for exact slices. */
function headingStart(from: number): number {
  // `from` already points at a line start recorded by the parser; keep any
  // leading indentation of that line so the whole heading line moves verbatim.
  return Math.max(0, from)
}

/**
 * Full source range of one section: its heading, its body and every descendant
 * heading. The end is the start of the next heading of the same or higher level,
 * which the caller took from the parser, never from a guessed offset.
 */
export function getSectionRange(items: OutlineItem[], sourceItem: OutlineItem, sourceLength: number): SectionRange | null {
  const index = items.findIndex(item => item.id === sourceItem.id)
  if (index === -1) return null
  const from = sourceItem.from
  if (typeof from !== 'number' || from < 0 || from > sourceLength) return null

  let to = sourceLength
  let descendantCount = 0
  for (let cursor = index + 1; cursor < items.length; cursor++) {
    const next = items[cursor]
    if (next.level <= sourceItem.level) {
      if (typeof next.from !== 'number') return null
      to = next.from
      break
    }
    descendantCount++
  }
  if (to < from) return null
  return { from: headingStart(from), to, item: sourceItem, descendantCount }
}

/**
 * Plans moving a whole section without touching anything else.
 *
 * The changes are a single delete/insert pair at most, so the surrounding text —
 * including line endings and whether the file ends with a newline — is preserved
 * byte for byte. No separator is invented: the moved slice already carries the
 * newline that terminated it in the original document.
 */
export function planOutlineMove(
  fullSource: string,
  items: OutlineItem[],
  sourceId: string,
  targetId: string,
  position: 'before' | 'after',
): OutlineMovePlan {
  const invalid = (error: string): OutlineMovePlan => ({
    valid: false,
    error,
    sourceRange: { from: 0, to: 0 },
    targetPos: 0,
    changes: [],
    newCaretPos: 0,
  })

  if (sourceId === targetId) return invalid('不能移动到自身')
  const sourceItem = items.find(item => item.id === sourceId)
  const targetItem = items.find(item => item.id === targetId)
  if (!sourceItem || !targetItem) return invalid('未找到对应章节')

  const sourceRange = getSectionRange(items, sourceItem, fullSource.length)
  const targetRange = getSectionRange(items, targetItem, fullSource.length)
  if (!sourceRange || !targetRange) return invalid('章节位置来自解析结果，当前无法定位')

  // A section can never be dropped inside itself or its own descendants.
  if (targetRange.from >= sourceRange.from && targetRange.from < sourceRange.to) {
    return invalid('禁止拖拽到自身或子章节内部')
  }
  if (sourceRange.to <= sourceRange.from) return invalid('章节内容为空，无法移动')

  const insertPos = position === 'before' ? targetRange.from : targetRange.to
  if (insertPos >= sourceRange.from && insertPos <= sourceRange.to) {
    return invalid('目标位置位于该章节内部')
  }

  let deleteFrom = sourceRange.from
  const deleteTo = sourceRange.to
  // A section that ends the file owns no trailing blank line, yet the blank line
  // before it belongs to the boundary. Absorb exactly one separator so the block
  // that becomes last keeps the file's final-newline state instead of gaining a
  // trailing blank line.
  if (deleteTo === fullSource.length) {
    while (
      deleteFrom >= 2 &&
      (fullSource[deleteFrom - 1] === '\n' || fullSource[deleteFrom - 1] === '\r') &&
      (fullSource[deleteFrom - 2] === '\n' || fullSource[deleteFrom - 2] === '\r')
    ) {
      deleteFrom -= 1
    }
  }

  // The moved slice is copied verbatim: its own trailing newline (or its absence
  // at end of file) travels with it.
  const section = fullSource.slice(sourceRange.from, sourceRange.to)
  if (!section) return invalid('章节源码为空')

  // Only end-of-file without a trailing newline lands mid-line. There the block
  // must be separated from the previous line, and the file's "no trailing
  // newline" state is kept instead of inventing one.
  const atLineStart = insertPos === 0 || /[\r\n]/.test(fullSource[insertPos - 1])
  const atEnd = insertPos === fullSource.length
  const eol = section.includes('\r\n') ? '\r\n' : '\n'
  const content = section.replace(/(?:\r\n|\n|\r)+$/, '')
  const fileEndsWithNewline = /[\r\n]$/.test(fullSource)
  // At the end of the file the moved block must not turn its own trailing blank
  // line into file-trailing whitespace: keep exactly the file's final-newline
  // state, and never concatenate two lines.
  const inserted = !atLineStart
    ? `\n${content}`
    : atEnd
      ? content + (fileEndsWithNewline ? eol : '')
      : section

  const changes: SourceChange[] =
    sourceRange.from < insertPos
      ? [
          { from: deleteFrom, to: deleteTo, insert: '' },
          { from: insertPos, to: insertPos, insert: inserted },
        ]
      : [
          { from: insertPos, to: insertPos, insert: inserted },
          { from: deleteFrom, to: deleteTo, insert: '' },
        ]

  // Caret target: start of the moved section after both edits are applied.
  const deletedLength = deleteTo - deleteFrom
  const newCaretPos = deleteFrom < insertPos
    ? insertPos - deletedLength
    : insertPos

  return {
    valid: true,
    sourceRange: { from: sourceRange.from, to: sourceRange.to },
    targetPos: insertPos,
    changes,
    newCaretPos,
  }
}

/** Applies a plan's changes to a string, for tests and previews. */
export function applyOutlineMove(fullSource: string, plan: OutlineMovePlan): string {
  let result = fullSource
  // Apply back to front so earlier offsets stay valid.
  const ordered = [...plan.changes].sort((a, b) => b.from - a.from)
  for (const change of ordered) result = result.slice(0, change.from) + change.insert + result.slice(change.to)
  return result
}
