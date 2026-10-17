import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

export const markumoHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.operatorKeyword], color: 'var(--pink)' },
  { tag: [tags.string, tags.special(tags.string), tags.inserted], color: 'var(--green)' },
  { tag: [tags.comment, tags.docComment], color: 'var(--syntax-comment, var(--muted))', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--yellow)' },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], color: 'var(--blue)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--blue)' },
  { tag: [tags.propertyName, tags.attributeName, tags.labelName], color: 'var(--yellow)' },
  { tag: [tags.variableName, tags.name], color: 'var(--ink)' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--syntax-operator, var(--sub))' },
  { tag: tags.heading, color: 'var(--accent)', fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
])
export const markumoSyntax = syntaxHighlighting(markumoHighlight)
