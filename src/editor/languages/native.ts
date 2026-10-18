import { LanguageSupport } from '@codemirror/language'
import { styleTags, tags } from '@lezer/highlight'
import { syntaxTags } from '../core/syntaxTheme'

export async function go() {
  const {go: base, goLanguage} = await import('@codemirror/lang-go')
  const support = base()
  return new LanguageSupport(goLanguage.configure({props: [styleTags({
    'MethodDecl/FieldName CallExpr/SelectorExpr/FieldName': tags.function(tags.propertyName),
    'Parameter/DefName': syntaxTags.parameter,
  })]}), support.support)
}
export async function rust() {
  const {rust: base, rustLanguage} = await import('@codemirror/lang-rust')
  const support = base()
  return new LanguageSupport(rustLanguage.configure({props: [styleTags({
    'Parameter/BoundIdentifier': syntaxTags.parameter,
  })]}), support.support)
}
export async function css() {
  const {css: base, cssLanguage} = await import('@codemirror/lang-css')
  const support = base()
  return new LanguageSupport(cssLanguage.configure({props: [styleTags({
    'CallExpression/Callee': tags.function(tags.variableName),
  })]}), support.support)
}
export async function python() {
  const {python: base, pythonLanguage} = await import('@codemirror/lang-python')
  const support = base()
  return new LanguageSupport(pythonLanguage.configure({props: [styleTags({
    'TypeDef/VariableName': tags.typeName,
    'ParamList/VariableName': syntaxTags.parameter,
  })]}), support.support)
}
export async function cmake() {
  const {cmake: base} = await import('@codemirror/legacy-modes/mode/cmake')
  const {StreamLanguage} = await import('@codemirror/language')
  return new LanguageSupport(StreamLanguage.define({
    ...base,
    token(stream, state) { const token = base.token(stream, state); return token === 'def' ? 'command' : token },
    tokenTable: {command: tags.function(tags.variableName)},
  }))
}
