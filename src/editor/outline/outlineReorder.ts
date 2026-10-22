import type { OutlineItem } from './outlineService'

export interface SectionRange {
  from: number
  to: number
  item: OutlineItem
  descendantCount: number
}

export interface OutlineMovePlan {
  valid: boolean
  error?: string
  sourceRange: { from: number; to: number }
  targetPos: number
  newSource: string
  newCaretPos: number
}

/**
 * Find the full source range of a section (heading + body + all child subheadings)
 */
export function getSectionRange(items: OutlineItem[], sourceItem: OutlineItem, sourceLength: number): SectionRange | null {
  const sourceIndex = items.findIndex(i => i.id === sourceItem.id)
  if (sourceIndex === -1) return null

  const from = sourceItem.from ?? 0
  let to = sourceLength
  let descendantCount = 0

  for (let i = sourceIndex + 1; i < items.length; i++) {
    const next = items[i]
    if (next.level <= sourceItem.level) {
      to = next.from ?? sourceLength
      break
    }
    descendantCount++
  }

  return { from, to, item: sourceItem, descendantCount }
}

/**
 * Plan the reordering of an entire section to a new target position
 */
export function planOutlineMove(
  fullSource: string,
  items: OutlineItem[],
  sourceId: string,
  targetId: string,
  position: 'before' | 'after'
): OutlineMovePlan {
  if (sourceId === targetId) {
    return { valid: false, error: '不能移动到自身', sourceRange: { from: 0, to: 0 }, targetPos: 0, newSource: fullSource, newCaretPos: 0 }
  }

  const sourceItem = items.find(i => i.id === sourceId)
  const targetItem = items.find(i => i.id === targetId)
  if (!sourceItem || !targetItem) {
    return { valid: false, error: '未找到对应章节', sourceRange: { from: 0, to: 0 }, targetPos: 0, newSource: fullSource, newCaretPos: 0 }
  }

  const sourceRange = getSectionRange(items, sourceItem, fullSource.length)
  if (!sourceRange) {
    return { valid: false, error: '计算章节范围失败', sourceRange: { from: 0, to: 0 }, targetPos: 0, newSource: fullSource, newCaretPos: 0 }
  }

  const targetRange = getSectionRange(items, targetItem, fullSource.length)
  if (!targetRange) {
    return { valid: false, error: '计算目标范围失败', sourceRange: { from: 0, to: 0 }, targetPos: 0, newSource: fullSource, newCaretPos: 0 }
  }

  // Prevent dragging into its own children / descendants
  if (targetRange.from >= sourceRange.from && targetRange.to <= sourceRange.to) {
    return { valid: false, error: '禁止拖拽到自身或子章节内部', sourceRange: { from: 0, to: 0 }, targetPos: 0, newSource: fullSource, newCaretPos: 0 }
  }

  // Extract source text
  let sectionText = fullSource.slice(sourceRange.from, sourceRange.to)
  // Ensure trailing newline for seamless insertion
  if (!sectionText.endsWith('\n')) {
    sectionText += '\n'
  }

  // Determine insert position in the original source
  let insertPos = position === 'before' ? targetRange.from : targetRange.to

  let newSource: string
  let newCaretPos: number

  if (sourceRange.from < insertPos) {
    // Moving downwards
    const beforeSection = fullSource.slice(0, sourceRange.from)
    const middlePart = fullSource.slice(sourceRange.to, insertPos)
    const afterPart = fullSource.slice(insertPos)

    newSource = beforeSection + middlePart + sectionText + afterPart
    newCaretPos = beforeSection.length + middlePart.length
  } else {
    // Moving upwards
    const beforeTarget = fullSource.slice(0, insertPos)
    const middlePart = fullSource.slice(insertPos, sourceRange.from)
    const afterSection = fullSource.slice(sourceRange.to)

    newSource = beforeTarget + sectionText + middlePart + afterSection
    newCaretPos = beforeTarget.length
  }

  return {
    valid: true,
    sourceRange: { from: sourceRange.from, to: sourceRange.to },
    targetPos: insertPos,
    newSource,
    newCaretPos,
  }
}
