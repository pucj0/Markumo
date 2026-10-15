import type { Extension } from '@codemirror/state'
import { StreamLanguage, LanguageDescription } from '@codemirror/language'

export const languageNames = ['Plain Text', 'Markdown', 'JSON', 'JSONC', 'YAML', 'TOML', 'JavaScript', 'TypeScript', 'JSX', 'TSX', 'Vue', 'HTML', 'CSS', 'Python', 'Go', 'Rust', 'SQL', 'XML', 'INI', 'CSV', 'Log'] as const
export type LanguageName = typeof languageNames[number]

const extensions: Record<string, LanguageName> = {
  md: 'Markdown', markdown: 'Markdown', txt: 'Plain Text', bat:'Plain Text', cmd:'Plain Text', log: 'Log', csv: 'CSV',
  json: 'JSON', jsonc: 'JSONC', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', jsx: 'JSX', tsx: 'TSX',
  vue: 'Vue', html: 'HTML', htm: 'HTML', css: 'CSS', py: 'Python', go: 'Go', rs: 'Rust',
  sql: 'SQL', xml: 'XML', svg: 'XML', ini: 'INI', cfg: 'INI',
}

export function detectLanguage(name: string): LanguageName {
  const filename = name.split(/[\\/]/).pop() || name
  const ext = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() : undefined
  return ext && extensions[ext] || 'Plain Text'
}

const loaders: Record<LanguageName, () => Promise<Extension>> = {
  'Plain Text': async () => [], CSV: async () => [], Log: async () => [],
  Markdown: async () => {
    const { markdown } = await import('@codemirror/lang-markdown')
    const { GFM } = await import('@lezer/markdown')
    const codeLanguages = [
      LanguageDescription.of({ name: 'JavaScript', alias: ['js'], load: async () => (await import('@codemirror/lang-javascript')).javascript() }),
      LanguageDescription.of({ name: 'TypeScript', alias: ['ts'], load: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }) }),
      LanguageDescription.of({ name: 'Rust', alias: ['rs'], load: async () => (await import('@codemirror/lang-rust')).rust() }),
      LanguageDescription.of({ name: 'Python', alias: ['py'], load: async () => (await import('@codemirror/lang-python')).python() }),
      LanguageDescription.of({ name: 'JSON', load: async () => (await import('@codemirror/lang-json')).json() }),
      LanguageDescription.of({ name: 'HTML', load: async () => (await import('@codemirror/lang-html')).html() }),
      LanguageDescription.of({ name: 'CSS', load: async () => (await import('@codemirror/lang-css')).css() }),
    ]
    return markdown({ extensions: [GFM], codeLanguages })
  },
  JSON: async () => (await import('@codemirror/lang-json')).json(),
  JSONC: async () => {
    const { json } = await import('@codemirror/legacy-modes/mode/javascript')
    return StreamLanguage.define(json)
  },
  YAML: async () => (await import('@codemirror/lang-yaml')).yaml(),
  TOML: async () => {
    const { toml } = await import('@codemirror/legacy-modes/mode/toml')
    return StreamLanguage.define(toml)
  },
  INI: async () => {
    const { properties } = await import('@codemirror/legacy-modes/mode/properties')
    return StreamLanguage.define(properties)
  },
  JavaScript: async () => (await import('@codemirror/lang-javascript')).javascript(),
  TypeScript: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }),
  JSX: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }),
  TSX: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true }),
  Vue: async () => (await import('@codemirror/lang-vue')).vue(),
  HTML: async () => (await import('@codemirror/lang-html')).html(),
  CSS: async () => (await import('@codemirror/lang-css')).css(),
  Python: async () => (await import('@codemirror/lang-python')).python(),
  Go: async () => (await import('@codemirror/lang-go')).go(),
  Rust: async () => (await import('@codemirror/lang-rust')).rust(),
  SQL: async () => (await import('@codemirror/lang-sql')).sql(),
  XML: async () => (await import('@codemirror/lang-xml')).xml(),
}

export function createLanguageLoader() {
  const pending = new Map<LanguageName, Promise<Extension>>()
  return (name: LanguageName) => {
    let result = pending.get(name)
    if (!result) {
      result = loaders[name]().catch(error => { pending.delete(name); throw error })
      pending.set(name, result)
    }
    return result
  }
}
export const loadLanguage = createLanguageLoader()
