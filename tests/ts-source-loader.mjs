// Runs repository TypeScript modules with Node's normal package resolver.
// No compiler/type-check claim; this loader only strips TypeScript for unit tests.
import ts from 'typescript'
import { readFile } from 'node:fs/promises'
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !/\.[a-z]+$/i.test(specifier)) {
    try { return await next(specifier + '.ts', context) } catch { return next(specifier, context) }
  }
  return next(specifier, context)
}
export async function load(url, context, next) {
  if (!url.endsWith('.ts')) return next(url, context)
  const source = await readFile(new URL(url), 'utf8')
  return { format: 'module', source: ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText, shortCircuit: true }
}
