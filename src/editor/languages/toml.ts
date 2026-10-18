import { LanguageSupport, StreamLanguage } from '@codemirror/language'
import { toml as base } from '@codemirror/legacy-modes/mode/toml'

export const toml = () => new LanguageSupport(StreamLanguage.define({
  ...base,
  token(stream, state) {
    const style = base.token(stream, state)
    if (style !== 'atom') return style
    const value = stream.current()
    if (value.startsWith('[')) return 'namespace'
    if (value === 'true' || value === 'false') return 'bool'
    return 'literal'
  },
}))
