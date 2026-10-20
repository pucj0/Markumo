// Read-only inventory of the checked-out implementation and generated artifacts.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import ts from 'typescript'

const output = path.resolve('test-results/phase07')
fs.mkdirSync(output, { recursive: true })
const read = file => fs.readFileSync(file, 'utf8')
const git = args => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim()
const ast = file => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true)
function array(name, file) {
  let result = []
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === name && node.initializer && ts.isArrayLiteralExpression(node.initializer))
      result = node.initializer.elements.filter(ts.isStringLiteral).map(e => e.text)
    ts.forEachChild(node, visit)
  }
  visit(ast(file)); return result
}
const smoke = array('SMOKE_TESTS', 'scripts/run-regressions.mjs')
const regression = array('FULL_REGRESSION_TESTS', 'scripts/run-regressions.mjs')
const scripts = fs.readdirSync('scripts').filter(name => name.endsWith('-regression.mjs')).map(name => `scripts/${name}`)
const languages = [], settings = []
function scan(node) {
  if (ts.isCallExpression(node) && ['entry', 'lexical'].includes(node.expression.getText()) && node.arguments.length >= 4 && node.arguments.slice(0, 2).every(ts.isStringLiteral)) {
    languages.push({ id: node.arguments[0].text, name: node.arguments[1].text, parserCoverage: node.expression.getText() === 'lexical' ? 'partial' : node.arguments[0].text === 'text' ? 'plain' : 'full' })
  }
  ts.forEachChild(node, scan)
}
scan(ast('src/editor/languages/index.ts'))
for (const statement of ast('src/features/shell/editorSettings.ts').statements)
  if (ts.isInterfaceDeclaration(statement) && statement.name.text === 'EditorSettings')
    for (const field of statement.members) if (field.name) settings.push(field.name.getText())
const handlerBody = /\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/.exec(read('src-tauri/src/lib.rs'))?.[1]
if (!handlerBody) throw Error('Native invoke handler registry was not found')
const commands = [...handlerBody.matchAll(/commands::(\w+)::(\w+)/g)].map(match => `${match[1]}::${match[2]}`)
const walk = dir => !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name)
  return entry.isDirectory() ? walk(file) : [{ path: file.replaceAll('\\', '/'), bytes: fs.statSync(file).size }]
})
const files = walk('dist'), html = fs.existsSync('dist/index.html') ? read('dist/index.html') : ''
const initial = [...new Set([...html.matchAll(/(?:src|href)="([^"?]+\.js)"/g)].map(match => match[1].replace(/^\//, '')))]
const sourceFiles = ['src/editor/languages/index.ts', 'src/features/document-conversion/ExportAppearance.ts', 'src/features/document-conversion/ExportStyles.ts']
const sourceStatus = sourceFiles.map(file => {
  const normalize = text => text.replaceAll('\r\n', '\n')
  return { file, equivalentToAcceptedCommit: normalize(read(file)) === normalize(git(['show', `503153b:${file}`]) + '\n') }
})
// Prefer archived production binaries: a later isolated startup build may use
// the same Cargo output filename but embed a different application identifier.
const artifacts = ['native-baseline', 'native-final'].flatMap(name => walk(`test-results/phase07/${name}`))
  .filter(file => file.path.endsWith('.exe') && !file.path.endsWith('markumo-isolated.exe'))
for (const file of artifacts) {
  file.sha256 = createHash('sha256').update(fs.readFileSync(file.path)).digest('hex')
  file.modifiedAt = fs.statSync(file.path).mtime.toISOString()
}
const result = {
  capturedAt: new Date().toISOString(), commit: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']), origin: git(['remote', 'get-url', 'origin']),
  status: git(['status', '--short']).split('\n'), sourceStatus, smoke, regression,
  standaloneScripts: scripts.filter(file => !regression.includes(file)), nativePdf: 'scripts/test-native-pdf.ps1',
  languages, settings, nativeCommands: [...new Set(commands)].sort(), capabilities: JSON.parse(read('src-tauri/capabilities/default.json')),
  tests: scripts.map(file => ({ file, smoke: smoke.includes(file), regression: regression.includes(file),
    assertions: [...read(file).matchAll(/(?:await\s+)?test\(\s*(['"`])([^\n]+?)\1/g)].map(match => match[2]) })),
  build: { totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), count: files.length,
    initialJs: initial.map(file => ({ path: file, bytes: fs.statSync(path.join('dist', file)).size })),
    largestJs: files.filter(file => file.path.endsWith('.js')).sort((a, b) => b.bytes - a.bytes).slice(0, 12),
    sourceMaps: files.filter(file => file.path.endsWith('.map')), artifacts }
}
fs.writeFileSync(path.join(output, 'inventory.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ commit: result.commit, smoke: smoke.length, regression: regression.length, languages: languages.length,
  nativeCommands: result.nativeCommands.length, totalBytes: result.build.totalBytes, initialJs: result.build.initialJs, artifacts, sourceStatus }, null, 2))
