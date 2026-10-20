export interface DiffLine { type: 'same' | 'add' | 'remove'; text: string }
export interface DiffResult { lines: DiffLine[]; truncated: boolean }

/** Small dependency-free line diff for the recovery comparison panel. It
 * trims common edges and uses LCS only for a bounded middle region. */
export function diffText(before: string, after: string, limit = 400): DiffResult {
  const oldLines = before.split(/\r\n|\r|\n/)
  const newLines = after.split(/\r\n|\r|\n/)
  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++
  let oldEnd = oldLines.length, newEnd = newLines.length
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) { oldEnd--; newEnd-- }
  const oldMiddle = oldLines.slice(start, oldEnd), newMiddle = newLines.slice(start, newEnd)
  const lines: DiffLine[] = []
  for (let i = Math.max(0, start - 2); i < start; i++) lines.push({ type: 'same', text: oldLines[i] })
  if (oldMiddle.length * newMiddle.length <= 250000) {
    const dp = Array.from({ length: oldMiddle.length + 1 }, () => new Uint16Array(newMiddle.length + 1))
    for (let i = oldMiddle.length - 1; i >= 0; i--) for (let j = newMiddle.length - 1; j >= 0; j--) {
      dp[i][j] = oldMiddle[i] === newMiddle[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
    let i = 0, j = 0
    while (i < oldMiddle.length || j < newMiddle.length) {
      if (i < oldMiddle.length && j < newMiddle.length && oldMiddle[i] === newMiddle[j]) { lines.push({ type: 'same', text: oldMiddle[i] }); i++; j++ }
      else if (j < newMiddle.length && (i >= oldMiddle.length || dp[i][j + 1] >= dp[i + 1][j])) { lines.push({ type: 'add', text: newMiddle[j++] }) }
      else { lines.push({ type: 'remove', text: oldMiddle[i++] }) }
    }
  } else {
    for (const text of oldMiddle) lines.push({ type: 'remove', text })
    for (const text of newMiddle) lines.push({ type: 'add', text })
  }
  for (let i = oldEnd; i < Math.min(oldLines.length, oldEnd + 2); i++) lines.push({ type: 'same', text: oldLines[i] })
  const truncated = lines.length > limit
  return { lines: truncated ? lines.slice(0, limit) : lines, truncated }
}
