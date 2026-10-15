import { register } from 'node:module'
register('./ts-source-loader.mjs', import.meta.url)
import assert from 'node:assert/strict'
import { EditorState, EditorSelection } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { syntaxTree } from '@codemirror/language'
import { history, undo, redo } from '@codemirror/commands'
import { mkdir, writeFile } from 'node:fs/promises'
const { readablePath, displayFilePath } = await import('../src/features/shell/pathDisplay.ts')
const { tableRow, tableModel, editTable, editTableCell } = await import('../src/editor/markdown/tableModel.ts')
const { tableField } = await import('../src/editor/markdown/tableField.ts')
const { settingsFrom, defaultSettings } = await import('../src/features/shell/editorSettings.ts')
const results = []
function test(name, fn) { try { fn(); results.push({ name, result: 'PASS' }) } catch (error) { results.push({ name, result: 'FAIL', error: String(error) }); process.exitCode = 1 } }
const state = text => EditorState.create({ doc: text, selection: { anchor: text.length }, extensions: [markdown({ extensions: [GFM] }), history(), tableField] })
const model = s => { const node = syntaxTree(s).topNode.getChild('Table'); return node && tableModel(s, node) }
const source = '| 名称 | 左 | 中 | 右 |\n| --- | :--- | :---: | ---: |\n| **中文** | a\\|b | `代码` |  |\n\n尾段'
test('Windows extended drive paths are display-only', () => { const raw = '\\\\?\\C:\\中文 文件\\a.md'; assert.equal(readablePath(raw), 'C:\\中文 文件\\a.md'); assert.equal(raw.startsWith('\\\\?\\'), true) })
test('UNC keeps server and share', () => { assert.equal(readablePath('\\\\?\\UNC\\server\\share\\a.md'), '\\\\server\\share\\a.md'); assert.equal(readablePath('\\\\server\\share\\a.md'), '\\\\server\\share\\a.md') })
test('Unknown device prefixes remain unchanged', () => { assert.equal(readablePath('\\\\?\\Volume{abc}\\file'), '\\\\?\\Volume{abc}\\file') })
test('Workspace boundaries, case and roots', () => { const root = { rootPath: '\\\\?\\C:\\Notes', name: 'Notes' }; assert.equal(displayFilePath('c:\\notes\\中文 文件.md', root, true), 'Notes/中文 文件.md'); assert.equal(displayFilePath('C:\\Notes2\\a', root), 'C:\\Notes2\\a'); assert.equal(displayFilePath('/src/a', { rootPath: '/SRC', name: 'SRC' }), '/src/a') })
test('Default replacement is Mod+R', () => assert.equal(defaultSettings().shortcuts.replace, 'Mod+R'))
test('Untouched legacy shortcut map migrates', () => { const {bold,italic,explorer,'close-current':close,...keys} = defaultSettings().shortcuts; const s={shortcuts:{...keys,sidebar:'Mod+B',replace:'Mod+H'}}; assert.equal(settingsFrom(s).shortcuts.replace, 'Mod+R') })
test('Explicit replacement remains unchanged', () => { const s = defaultSettings(); s.shortcuts.replace = 'Mod+H'; assert.equal(settingsFrom(s).shortcuts.replace, 'Mod+H') })
test('Ambiguous old custom map is preserved', () => { const s = defaultSettings(); delete s.shortcutVersion; s.shortcuts.replace = 'Mod+H'; s.shortcuts.find = 'Mod+Alt+F'; assert.equal(settingsFrom(s).shortcuts.replace, 'Mod+H') })
test('Missing settings keep defaults', () => assert.equal(settingsFrom({}).shortcuts.replace, 'Mod+R'))
test('GFM recognition and column alignment', () => { const m = model(state(source)); assert.ok(m); assert.equal(m.rows.length, 2); assert.deepEqual(m.align, ['left','left','center','right']); assert.equal(m.rows[1].cells[3].text, '') })
test('Escaped pipes and inline source mapping', () => { const s = state(source), m = model(s); assert.equal(m.rows[1].cells[1].text, 'a\\|b'); for (const row of m.rows) for (const cell of row.cells) assert.equal(s.sliceDoc(cell.from, cell.to), cell.text) })
test('Empty inner cells retain columns', () => assert.equal(tableRow('| a || c |', 0).cells.length, 3))
test('Odd versus even slash escaping', () => { assert.equal(tableRow('| a\\|b |', 0).cells.length, 1); assert.equal(tableRow('| a\\\\|b |', 0).cells.length, 2) })
test('Fenced code and malformed separators stay source', () => { assert.equal(model(state('```\n|a|b|\n|-|-|\n|c|d|\n```')), null); assert.equal(model(state('|a|b|\n|no|---|\n|c|d|')), null) })
test('Missing body cells have safe end mapping', () => { const m = model(state('|a|b|\n|-|-|\n|c|\n\nend')); assert.equal(m.rows[1].cells[1].from, m.rows[1].to); assert.equal(editTableCell(m, 1, 1, 'value'), null) })
test('Cell edits stay in transaction and preserve other bytes', () => { const s = state(source), m = model(s), next = s.update(editTableCell(m, 1, 0, '新的|字')).state; assert.equal(next.sliceDoc(m.rows[1].cells[0].from, m.rows[1].cells[0].from + 5), '新的\\|字'); assert.equal(next.sliceDoc(next.doc.length - 2), '尾段') })
test('Table row and column operations remain GFM', () => { let s = state(source); for (const operation of ['row-add','column-add','row-delete','column-delete']) { const m = model(s); s = s.update(editTable(m, operation, 1, 1)).state; assert.ok(model(s)); assert.equal(s.sliceDoc(s.doc.length - 2), '尾段') } })
test('Header and final column cannot be deleted', () => { const m = model(state('|a|\n|-|\n|b|\n\nend')); assert.equal(editTable(m, 'row-delete', 0, 0), null); assert.equal(editTable(m, 'column-delete', 1, 0), null) })
test('Cell edit undo and redo use CodeMirror history', () => { let s = state(source); const changed = s.update(editTableCell(model(s), 1, 0, '编辑')).state; s = changed; assert.ok(undo({ get state() { return s }, dispatch: tr => { s = tr.state } })); assert.equal(s.doc.toString(), source); assert.ok(redo({ get state() { return s }, dispatch: tr => { s = tr.state } })); assert.equal(s.doc.toString(), changed.doc.toString()) })
test('Direct block widget, local editing and source invariant', () => { let s = state(source); let blocks = 0; s.field(tableField).decorations.between(0, s.doc.length, (_from, _to, d) => { if (d.spec.block) blocks++ }); assert.equal(blocks, 1); const m = model(s); s = s.update({ selection: EditorSelection.cursor(m.rows[1].cells[0].from) }).state; blocks = 0; s.field(tableField).decorations.between(0, s.doc.length, (_from, _to, d) => { if (d.spec.block) blocks++ }); assert.equal(blocks, 0); assert.equal(s.doc.toString(), source) })
await mkdir('test-results/ux-special', { recursive: true })
await writeFile('test-results/ux-special/model-results.json', JSON.stringify({ results }, null, 2))
for (const result of results) console.log(`${result.result} ${result.name}${result.error ? ': ' + result.error : ''}`)
console.log(`${results.filter(r => r.result === 'PASS').length}/${results.length} PASS; module execution only, no browser/desktop claim`)
