import { javascript as baseJavascript } from '@codemirror/lang-javascript'
import { LanguageSupport, LRLanguage } from '@codemirror/language'
import { styleTags, tags } from '@lezer/highlight'
import { syntaxTags } from '../core/syntaxTheme'

export function javascript(config: Parameters<typeof baseJavascript>[0] = {}) {
  const support = baseJavascript(config)
  if (!(support.language instanceof LRLanguage)) return support
  return new LanguageSupport(support.language.configure({props: [styleTags({
    'ParamList/VariableDefinition': syntaxTags.parameter,
    'MethodDeclaration/PropertyDefinition': tags.function(tags.definition(tags.propertyName)),
  })]}), support.support)
}
