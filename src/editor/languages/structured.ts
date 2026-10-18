import { LanguageSupport, StreamLanguage, type StreamParser } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { syntaxTags } from '../core/syntaxTheme'

const support = <S>(parser: StreamParser<S>) => new LanguageSupport(StreamLanguage.define(parser))

interface JsonState { stack: {object: boolean; key: boolean}[]; comment: boolean }
// JSONC's lexical grammar, including object key context across line breaks.
// JavaScript's legacy JSON mode conflates true/false/null under `atom`.
export const jsonc = () => support<JsonState>({
  name: 'jsonc', startState: () => ({stack: [], comment: false}),
  copyState: state => ({stack: state.stack.map(frame => ({...frame})), comment: state.comment}),
  token(stream, state) {
    if (state.comment) { if (stream.skipTo('*/')) { stream.match('*/'); state.comment = false } else stream.skipToEnd(); return 'comment' }
    if (stream.eatSpace()) return null
    if (stream.match('//')) { stream.skipToEnd(); return 'comment' }
    if (stream.match('/*')) { state.comment = true; return 'comment' }
    const top = state.stack[state.stack.length - 1]
    if (stream.peek() === '"') {
      stream.next()
      while (!stream.eol()) { const char = stream.next(); if (char === '\\') stream.next(); else if (char === '"') break }
      return top?.object && top.key ? 'propertyName' : 'string'
    }
    if (stream.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)) return 'number'
    if (stream.match(/^(?:true|false)\b/)) return 'bool'
    if (stream.match(/^null\b/)) return 'null'
    const char = stream.next()
    if (char === '{' || char === '[') state.stack.push({object: char === '{', key: char === '{'})
    else if (char === '}' || char === ']') state.stack.pop()
    else if (char === ':' && top) top.key = false
    else if (char === ',' && top?.object) top.key = true
    return /[{}[\],:]/.test(char || '') ? 'punctuation' : 'invalid'
  },
  tokenTable: {bool: t.bool, null: t.null},
  languageData: {commentTokens: {line: '//', block: {open: '/*', close: '*/'}}, closeBrackets: {brackets: ['{', '[', '"']}},
})

export const ini = () => support({
  name: 'ini', startState: () => ({value: false, continuation: false, continued: false}),
  token(stream, state) {
    if (stream.sol()) { state.continued = state.continuation; state.value = state.continuation; state.continuation = false }
    if (stream.eatSpace()) return null
    if (!state.value && stream.match(/^[#;!].*/)) return 'comment'
    if (!state.value && stream.match(/^\[[^\]]*\]/)) return 'namespace'
    if (!state.value && stream.match(/^export\b(?=\s)/)) return 'keyword'
    if (!state.value && stream.match(/^[^=:\s]+(?=\s*[=:])/)) return 'propertyName'
    if (!state.value && stream.match(/^[=:]/)) { state.value = true; return 'operator' }
    if (state.value) {
      if (!state.continued && stream.match(/^[#;].*/)) return 'comment'
      if (stream.match(/^"(?:[^"\\]|\\.)*(?:"|$)|^'(?:[^'\\]|\\.)*(?:'|$)/)) {
        state.continuation = /(?:^|[^\\])(?:\\\\)*\\$/.test(stream.current())
        return 'string'
      }
      const match = stream.match(state.continued ? /^.+/ : /^.*?(?=\s+[;#]|$)/)
      if (match && stream.current()) {
        const value = stream.current().trim()
        state.continuation = /(?:^|[^\\])(?:\\\\)*\\$/.test(value)
        if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return 'number'
        if (/^(true|false)$/i.test(value)) return 'bool'
        return 'string'
      }
    }
    stream.next(); return null
  },
  languageData: {commentTokens: {line: '#'}},
})

// CSV remains raw text: only quoted fields and separators receive color. This
// bounded stream state handles doubled quotes and quoted multiline fields.
export const csv = () => support({
  name: 'csv', startState: () => ({quoted: false, fieldStart: true}),
  token(stream, state) {
    if (stream.sol() && !state.quoted) state.fieldStart = true
    if (state.quoted || (state.fieldStart && stream.peek() === '"')) {
      if (!state.quoted) { stream.next(); state.quoted = true }
      while (!stream.eol()) if (stream.next() === '"') {
        if (stream.peek() === '"') stream.next()
        else { state.quoted = false; break }
      }
      state.fieldStart = false; return 'string'
    }
    if (stream.eat(',')) { state.fieldStart = true; return 'separator' }
    stream.eatWhile(char => char !== ','); state.fieldStart = false; return null
  },
})

export const log = () => support({
  name: 'log', startState: () => ({prefix: true}),
  token(stream, state) {
    if (stream.sol()) state.prefix = true
    if (stream.eatSpace()) return null
    if (state.prefix) {
      if (stream.match(/^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?/)) return 'comment'
      const level = stream.match(/^\[?(ERROR|FATAL|WARN(?:ING)?|INFO|DEBUG|TRACE)\]?(?=\s|:|$)/)
      state.prefix = false
      if (level) {
        const name = (level as RegExpMatchArray)[1]
        return /ERROR|FATAL/.test(name) ? 'logError' : /WARN/.test(name) ? 'logWarning' : name === 'INFO' ? 'logInfo' : 'logDebug'
      }
    }
    stream.skipToEnd(); return null
  }, tokenTable: syntaxTags,
})

const diagramKeywords = new Set(('flowchart graph subgraph end sequenceDiagram participant actor activate deactivate loop alt else opt par and critical option break rect note over left right of as autonumber title stateDiagram stateDiagram-v2 classDiagram class erDiagram gantt section dateFormat journey pie gitGraph mindmap timeline quadrantChart xychart-beta block-beta architecture-beta TD TB BT LR RL').split(' '))
// Deliberately lexical: supports declarations, comments, quoted labels and arrows,
// and does not claim to validate Mermaid's many diagram grammars.
export const mermaid = () => support({
  name: 'mermaid', startState: () => ({quote: false, labelDepth: 0}),
  token(stream, state) {
    if (state.quote || stream.peek() === '"') {
      if (!state.quote) { stream.next(); state.quote = true }
      while (!stream.eol()) { const char = stream.next(); if (char === '\\') stream.next(); else if (char === '"') { state.quote = false; break } }
      return 'string'
    }
    if (stream.eatSpace()) return null
    if (stream.match(/^[\[({]/)) { state.labelDepth++; return 'punctuation' }
    if (stream.match(/^[\])}]/)) { state.labelDepth = Math.max(0, state.labelDepth - 1); return 'punctuation' }
    if (state.labelDepth && stream.match(/^[^\[\]{}()"]+/)) return 'string'
    if (stream.match('%%')) { stream.skipToEnd(); return 'comment' }
    if (stream.match(/^(?:--?>|==>|-\.->|--|==|:::+|[<>=|:]+)/)) return 'operator'
    const word = stream.match(/^[\p{L}_][\p{L}\p{N}_-]*/u)
    if (word) return diagramKeywords.has(stream.current()) ? 'keyword' : null
    if (stream.match(/^\d+(?:\.\d+)?/)) return 'number'
    stream.next(); return null
  }, languageData: {commentTokens: {line: '%%'}},
})

export const ignore = () => support({
  name: 'ignore', token(stream) {
    if (stream.sol() && stream.match('#')) { stream.skipToEnd(); return 'comment' }
    if (stream.sol() && stream.eat('!')) return 'operator'
    if (stream.match(/^\\./)) return 'string'
    if (stream.match(/^(?:\*\*|[*?]|\[[^\]]*\])/)) return 'operator'
    if (stream.eat('/')) return 'punctuation'
    stream.next(); return null
  },
})
