import { html as baseHtml } from '@codemirror/lang-html'
import { LanguageSupport, StreamLanguage } from '@codemirror/language'
import { javascript } from './javascript'
import { css } from './native'

export async function html() {
  const js = javascript(), ts = javascript({typescript: true}), jsx = javascript({jsx: true}), tsx = javascript({typescript: true, jsx: true})
  const [styles, legacy] = await Promise.all([css(), import('@codemirror/legacy-modes/mode/css')])
  return baseHtml({nestedLanguages: [
    {tag: 'script', attrs: attrs => attrs.lang === 'tsx' || attrs.type === 'text/typescript-jsx', parser: tsx.language.parser},
    {tag: 'script', attrs: attrs => attrs.lang === 'ts' || attrs.type === 'text/typescript', parser: ts.language.parser},
    {tag: 'script', attrs: attrs => attrs.lang === 'jsx' || attrs.type === 'text/jsx', parser: jsx.language.parser},
    {tag: 'script', attrs: attrs => !attrs.type || /^(?:(?:text|application)\/(?:x-)?(?:java|ecma)script|module)$/i.test(attrs.type), parser: js.language.parser},
    {tag: 'style', attrs: attrs => attrs.lang === 'scss', parser: StreamLanguage.define(legacy.sCSS).parser},
    {tag: 'style', attrs: attrs => attrs.lang === 'less', parser: StreamLanguage.define(legacy.less).parser},
    {tag: 'style', attrs: attrs => !attrs.lang || attrs.lang === 'css', parser: styles.language.parser},
  ]})
}
export async function vue(): Promise<LanguageSupport> {
  const [{vue: baseVue}, base] = await Promise.all([import('@codemirror/lang-vue'), html()])
  return baseVue({base})
}
