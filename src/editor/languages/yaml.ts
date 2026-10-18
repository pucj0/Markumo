import { yaml as baseYaml } from '@codemirror/lang-yaml'
import { LanguageSupport, LRLanguage } from '@codemirror/language'
import { styleTags, tags } from '@lezer/highlight'

export function yaml() {
  const base = baseYaml()
  if (!(base.language instanceof LRLanguage)) return base
  const language = base.language.configure({props: [styleTags({BlockLiteralContent: tags.string})]})
  return new LanguageSupport(language, base.support)
}
