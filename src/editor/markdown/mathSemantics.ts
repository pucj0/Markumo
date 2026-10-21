import type MarkdownIt from 'markdown-it'

/** Shared delimiter policy for the Live parser and read-only preview. */
export function mathBlockParts(source: string) {
  const match = /^([ \t]*\$\$(?:\r?\n)?)([\s\S]*?)((?:\r?\n)?\$\$[ \t]*)$/.exec(source)
  return match ? { opening: match[1], value: match[2], closing: match[3] } : null
}

function escaped(source: string, at: number) {
  let count = 0
  while (at > 0 && source[--at] === '\\') count++
  return count % 2 === 1
}

export function inlineMathEnd(source: string, from: number): number | null {
  if (source[from] !== '$' || source[from + 1] === '$' || escaped(source, from)) return null
  for (let end = from + 1; end < source.length; end++) {
    if (source[end] === '\n' || source[end] === '\r') return null
    if (source[end] !== '$' || escaped(source, end)) continue
    // The same currency/whitespace policy applies in both modes.
    if (source[end + 1] === '$' || /\d/.test(source[end + 1] || '')) return null
    if (/^\d[\d.,]*\s+\p{L}[\p{L}\s,，。.]*$/u.test(source.slice(from + 1, end))) return null
    return end
  }
  return null
}

export function installMarkdownMath(md: ReturnType<typeof MarkdownIt>) {
  md.block.ruler.before('fence', 'markumo_math_block', (state, startLine, endLine, silent) => {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false
    const from = state.bMarks[startLine] + state.tShift[startLine]
    if (!state.src.startsWith('$$', from)) return false
    for (let line = startLine; line < endLine; line++) {
      const end = state.eMarks[line], text = state.src.slice(state.bMarks[line], end)
      const closing = text.search(/\$\$[ \t]*$/)
      if (closing < 0 || escaped(text, closing) || line === startLine && state.src.slice(from, end).trimEnd().length < 4) continue
      if (silent) return true
      const token = state.push('math_block', 'div', 0)
      token.block = true; token.map = [startLine, line + 1]
      token.content = state.src.slice(from, end)
      state.line = line + 1
      return true
    }
    return false
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
  md.inline.ruler.before('escape', 'markumo_math_inline', (state, silent) => {
    const end = inlineMathEnd(state.src, state.pos)
    if (end === null) return false
    if (!silent) { const token = state.push('math_inline', 'span', 0); token.content = state.src.slice(state.pos + 1, end) }
    state.pos = end + 1
    return true
  })
}
