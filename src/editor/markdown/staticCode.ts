import type { SyntaxSpan } from '../core/syntaxSpans'

/** Split source ranges, never highlighted HTML. A multi-line token is closed
 * and reopened on each row; overlapping YAML/Lezer classes remain combined. */
export function staticCodeLines(code: string, spans: readonly SyntaxSpan[], escape: (value: string) => string, compact = false) {
  const lines = code.split('\n'), starts = [0]
  for (let i = 0; i < lines.length - 1; i++) starts.push(starts[i] + lines[i].length + 1)
  const ranges: { from: number; to: number; classes: string }[][] = lines.map(() => [])
  for (const span of spans) {
    let low = 0, high = starts.length
    while (low + 1 < high) { const mid = (low + high) >>> 1; if (starts[mid] <= span.from) low = mid; else high = mid }
    for (let row = low; row < lines.length && starts[row] < span.to; row++) {
      const from = Math.max(0, span.from - starts[row]), to = Math.min(lines[row].length, span.to - starts[row])
      if (to > from) ranges[row].push({ from, to, classes: span.classes })
    }
  }
  return lines.map((line, index) => {
    const row = ranges[index], points = [...new Set([0, line.length, ...row.flatMap(range => [range.from, range.to])])].sort((a,b) => a-b)
    let html = ''
    for (let i = 0; i + 1 < points.length; i++) {
      const from = points[i], to = points[i + 1], text = escape(line.slice(from, to))
      const classes = [...new Set(row.filter(range => range.from <= from && range.to >= to).flatMap(range => range.classes.split(' ')))].join(' ')
      html += classes ? `<span class="${escape(classes)}">${text}</span>` : text
    }
    if (compact) return `<span class="md-code-line md-code-text" data-line="${index + 1}">${html}</span>`
    const number = String(index + 1).padStart(Math.max(2, String(lines.length).length), ' ')
    return `<span class="md-code-line"><span class="md-code-number" aria-hidden="true">${number}</span><span class="md-code-text">${html}</span></span>`
  }).join('')
}
