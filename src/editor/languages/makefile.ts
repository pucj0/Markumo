import { LanguageSupport, StreamLanguage, type StreamParser } from '@codemirror/language'
// legacy-modes has no Makefile parser. Recipes stay text and are never executed.
const parser: StreamParser<null> = {
  startState: () => null,
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match('#')) { stream.skipToEnd(); return 'comment' }
    if (stream.match(/\$\([^)]+\)|\$\{[^}]+\}|\$[@<^?*%+]/)) return 'variableName'
    if (stream.match(/(?:include|ifeq|ifneq|ifdef|ifndef|else|endif|export|override|define|endef)\b/)) return 'keyword'
    if (stream.match(/[\w./%+-]+(?=\s*:)/)) return 'labelName'
    if (stream.match(/[:?+!]?=|:/)) return 'operator'
    if (stream.match(/"(?:[^"\\]|\\.)*"|'[^']*'/)) return 'string'
    if (stream.match(/\d+/)) return 'number'
    stream.next(); return null
  },
}
export const makefile = () => new LanguageSupport(StreamLanguage.define(parser))
