export const treeRowHeight = 26
export function treeWindow(total: number, scrollTop: number, height: number) {
  const visible = Math.max(1, Math.ceil(height / treeRowHeight) + 1)
  const overscan = Math.max(4, Math.ceil(visible * .2))
  const count = Math.min(total, visible + overscan * 2)
  const start = Math.max(0, Math.min(Math.floor(scrollTop / treeRowHeight) - overscan, total - count))
  return { start, count, before: start * treeRowHeight, after: Math.max(0, total - start - count) * treeRowHeight }
}
