import { Fragment, type Node } from 'prosemirror-model'
import type { SourceBlock } from './MarkdownParser'

interface ParsedSource { doc: Node; blocks: SourceBlock[] }

/** Keep stable identities around a canonical source edit. Raw equality alone
 * is insufficient: a reference definition can change an otherwise equal block.
 * Reuse only semantically equal immutable nodes, without retaining old revisions. */
export function reuseSourceBlocks(next: ParsedSource, previous: ParsedSource) {
  const parsedIds = next.blocks.map(block => block.id)
  const equal = (before: SourceBlock, after: SourceBlock) => before.raw === after.raw &&
    before.node.type === after.node.type && after.node.type.create(
      { ...after.node.attrs, sourceId: before.id }, after.node.content, after.node.marks,
    ).eq(before.node)
  const reuse = (before: SourceBlock, after: SourceBlock) => {
    after.id = before.id
    after.node = before.node
  }
  let start = 0, oldEnd = previous.blocks.length, newEnd = next.blocks.length
  while (start < oldEnd && start < newEnd && equal(previous.blocks[start], next.blocks[start])) {
    reuse(previous.blocks[start], next.blocks[start]); start++
  }
  while (oldEnd > start && newEnd > start && equal(previous.blocks[oldEnd - 1], next.blocks[newEnd - 1])) {
    reuse(previous.blocks[--oldEnd], next.blocks[--newEnd])
  }
  // A local change within one block keeps that block's identity as well. Its
  // new content remains authoritative and is diffed by ProseMirror normally.
  if (oldEnd - start === 1 && newEnd - start === 1) {
    const before = previous.blocks[start], after = next.blocks[start]
    if (before.node.type === after.node.type) {
      after.id = before.id
      after.node = after.node.type.create({ ...after.node.attrs, sourceId: before.id }, after.node.content, after.node.marks)
    }
  }
  // Matching a suffix can move an old ID away from an identical newly inserted
  // block. Reserve the stable edges first, then repair only middle collisions.
  const used = new Set([...next.blocks.slice(0, start), ...next.blocks.slice(newEnd)].map(block => block.id))
  const collisions: SourceBlock[] = []
  for (const block of next.blocks.slice(start, newEnd)) {
    if (used.has(block.id)) collisions.push(block)
    else used.add(block.id)
  }
  let available = 0
  for (const block of collisions) {
    while (available < parsedIds.length && used.has(parsedIds[available])) available++
    let id = parsedIds[available++] || `${block.id}-inserted`
    while (used.has(id)) id += '-inserted'
    used.add(id); block.id = id
    block.node = block.node.type.create({ ...block.node.attrs, sourceId: id }, block.node.content, block.node.marks)
  }
  if (next.blocks.length) next.doc = next.doc.copy(Fragment.from(next.blocks.map(block => block.node)))
}
