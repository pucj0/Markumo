import { StreamLanguage, type StreamParser, LanguageSupport } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

const keywords = new Set([
  'if', 'else', 'for', 'in', 'do', 'goto', 'call', 'exit', 'setlocal', 'endlocal',
  'shift', 'not', 'exist', 'defined', 'errorlevel', 'cmdextversion',
  'equ', 'neq', 'lss', 'leq', 'gtr', 'geq'
])

const builtins = new Set([
  '@echo', 'echo', 'set', 'pause', 'cls', 'title', 'color', 'prompt',
  'copy', 'xcopy', 'robocopy', 'move', 'del', 'erase', 'ren', 'rename',
  'mkdir', 'md', 'rmdir', 'rd', 'dir', 'type', 'cd', 'chdir',
  'pushd', 'popd', 'find', 'findstr', 'chcp', 'start', 'powershell', 'pwsh',
  'attrib', 'assoc', 'ftype', 'choice', 'timeout', 'tasklist', 'taskkill'
])

export const batchParser: StreamParser<unknown> = {
  token(stream) {
    if (stream.eatSpace()) return null

    // Comments: line starting with :: or rem
    if (stream.sol() && stream.match(/^\s*::.*/)) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match(/^rem(\s+.*|$)/i)) {
      stream.skipToEnd()
      return 'comment'
    }

    // Labels: :label (at start of line or after call/goto)
    if (stream.match(/^:[a-zA-Z0-9_\-]+/)) {
      return 'label'
    }

    // Strings: "double quoted string"
    if (stream.match(/^"[^"]*"?/)) {
      return 'string'
    }

    // Parameter variables: %~dp0, %~f1, %~1, %1..%9, %*, %%a
    if (stream.match(/^%~[a-zA-Z]*\d/) || stream.match(/^%\d/) || stream.match(/^%\*/) || stream.match(/^%%[a-zA-Z]/)) {
      return 'variable'
    }

    // Environment variables: %VAR%, %DATE%, %WEB%
    if (stream.match(/^%[a-zA-Z0-9_#$@\-]+%/)) {
      return 'variable'
    }

    // Delayed expansion variables: !VAR!, !COUNT!
    if (stream.match(/^![a-zA-Z0-9_#$@\-]+!/)) {
      return 'variable'
    }

    // Operators and redirection
    if (stream.match(/^(==|&&|\|\||>>|>|<|\||&)/)) {
      return 'operator'
    }

    // Numbers
    if (stream.match(/^\d+/)) {
      return 'number'
    }

    // Commands and keywords
    if (stream.match(/^@?[a-zA-Z_][a-zA-Z0-9_\-]*/)) {
      const word = stream.current().toLowerCase()
      if (keywords.has(word)) return 'keyword'
      if (builtins.has(word)) return 'builtin'
      return null
    }

    stream.next()
    return null
  },
  tokenTable: {
    keyword: t.keyword,
    builtin: t.standard(t.keyword),
    comment: t.lineComment,
    string: t.string,
    variable: t.variableName,
    label: t.labelName,
    operator: t.operator,
    number: t.number,
  }
}

export function batch(): LanguageSupport {
  return new LanguageSupport(StreamLanguage.define(batchParser))
}
