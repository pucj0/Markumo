import type { LanguageSupport } from '@codemirror/language'
import { highlightTree } from '@lezer/highlight'
import { markumoHighlight } from './syntaxTheme'
import { yamlScalarSpans } from './yamlScalars'

export interface SyntaxSpan { from: number; to: number; classes: string }
/** Shared static renderer. CodeMirror uses the same highlighter plus the
 * viewport-bounded YAML scalar adapter, with no full-document decorations. */
export function syntaxSpans(code: string, support: LanguageSupport) {
  const tree = support.language.parser.parse(code), spans: SyntaxSpan[] = []
  highlightTree(tree, markumoHighlight, (from, to, classes) => spans.push({from, to, classes}))
  if (support.language.name === 'yaml' || support.language.name === 'markdown') spans.push(...yamlScalarSpans(tree, (from, to) => code.slice(from, to)))
  return spans.sort((a, b) => a.from - b.from || a.to - b.to)
}
