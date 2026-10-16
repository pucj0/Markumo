import { describe, expect, it } from 'vitest'
import { EditorState as CMState } from '@codemirror/state'
import { search, setSearchQuery } from '@codemirror/search'
import { history, undo, redo } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import { EditorState as PMState } from 'prosemirror-state'
import { createSearchQuery, emptySearchOptions, expandReplacement, regexError, replaceEditorMatches, type SearchOptions } from '../src/editor/core/searchQuery'
import { findMatches, replacementText, replaceMatch } from '../src/editor/markdown/wysiwyg/plugins/LiveSearch'
import { MarkdownSourceBridge } from '../src/editor/markdown/wysiwyg/MarkdownSourceBridge'
import { defaultSettings, settingsFrom, persistedSettings } from '../src/features/shell/editorSettings'
import { treeWindow } from '../src/features/workspace/virtualTree'

const sample = "import123\nimport2Something\nimport 123\nimport Vue from 'vue'\nimport Foo from './foo'"
const options = (patch: Partial<SearchOptions>): SearchOptions => ({ ...emptySearchOptions(), ...patch })
function sourceMatches(text: string, query: SearchOptions) {
  const cursor = createSearchQuery(query).getCursor(CMState.create({ doc: text })), values: string[] = []
  for (let item = cursor.next(); !item.done; item = cursor.next()) values.push(text.slice(item.value.from, item.value.to))
  return values
}
function liveMatches(text: string, query: SearchOptions) {
  return findMatches(new MarkdownSourceBridge(text).doc, query).matches.map(m => m.text)
}
describe('Source and Live share regex semantics', () => {
  const cases: [string, string, Partial<SearchOptions>, string[]][] = [
    ['numeric imports', sample, { search: '(import)(\\d+)', regexp: true }, ['import123', 'import2']],
    ['identifier imports', sample, { search: 'import\\s+(\\w+)', regexp: true }, ['import 123', 'import Vue', 'import Foo']],
    ['regex disabled is literal', sample, { search: '(import)(\\d+)' }, []],
    ['literal punctuation', 'a.b axb a.b', { search: 'a.b' }, ['a.b', 'a.b']],
    ['literal backslashes', 'path\\next path\nnext', { search: 'path\\next' }, ['path\\next']],
    ['multiline anchors', 'import123\nimport2Something\nhello', { search: '^import\\d+', regexp: true }, ['import123', 'import2']],
    ['Chinese Unicode', '中文123 汉字456 😀', { search: '\\p{L}+\\d+', regexp: true }, ['中文123', '汉字456']],
    ['case and whole word', 'Vue vue VUE Vues', { search: 'Vue', caseSensitive: true, wholeWord: true }, ['Vue']],
    ['whole word alternatives', 'foo foobar bar', { search: 'foo|bar', regexp: true, wholeWord: true }, ['foo', 'bar']],
    ['case independent', 'import123 IMPORT2', { search: '(import)(\\d+)', regexp: true }, ['import123', 'IMPORT2']],
    ['zero width Unicode advances once per codepoint', '😀a', { search: '(?=.)', regexp: true }, ['', '']],
    ['multiline zero width', 'ab\nab', { search: '^', regexp: true }, ['', '']],
    ['astral Unicode whole words', '𐐀 x𐐀 𐐀x', { search: '𐐀', wholeWord: true }, ['𐐀']],
  ]
  it.each(cases)('%s', (_name, text, patch, expected) => {
    const query = options(patch)
    expect(sourceMatches(text, query)).toEqual(expected)
    expect(liveMatches(text, query)).toEqual(expected)
  })
  it('reports a concrete syntax error only when regex is enabled', () => {
    expect(regexError({ search: '[', regexp: true })).toMatch(/正则表达式无效.+/)
    expect(createSearchQuery(options({ search: '[', regexp: true })).valid).toBe(false)
    expect(findMatches(new MarkdownSourceBridge(sample).doc, options({ search: '[', regexp: true })).valid).toBe(false)
    expect(regexError({ search: '[', regexp: false })).toBe('')
    expect(regexError({ search: '', regexp: true })).toBe('')
  })
  it('expands JavaScript dollar sequences from original contextual captures', () => {
    const result = /(?<=before )(?<word>import)(\d+)(?= after)/gu.exec('before import123 after')!
    const pattern = "$1-$2/$&/$$/$<word>/$`/$'/$12/$0"
    expect(expandReplacement(result, pattern)).toBe('import-123/import123/$/import/before / after/import2/$0')
    expect(expandReplacement(/(a)?(b)/u.exec('b')!, '$1-$2')).toBe('-b')
  })
  it('replaces multiple differently sized matches once, with one Undo/Redo', () => {
    let state = CMState.create({ doc: sample, extensions: [search(), history()] })
    state = state.update({ effects: setSearchQuery.of(createSearchQuery(options({ search: '(import)(\\d+)', replace: '$1-$2/$&/$$', regexp: true }))) }).state
    const target = { get state() { return state }, composing: false, dispatch: (spec: Parameters<CMState['update']>[0]) => { state = state.update(spec).state } }
    expect(replaceEditorMatches(target as unknown as EditorView, true)).toBe(true)
    const expected = sample.replace(/(import)(\d+)/gu, '$1-$2/$&/$$')
    expect(state.doc.toString()).toBe(expected)
    expect(undo(target as unknown as EditorView)).toBe(true); expect(state.doc.toString()).toBe(sample)
    expect(redo(target as unknown as EditorView)).toBe(true); expect(state.doc.toString()).toBe(expected)
    const bridge = new MarkdownSourceBridge(sample), pm = PMState.create({ doc: bridge.doc }), query = options({ search: '(import)(\\d+)', regexp: true })
    const tr = pm.tr
    for (const match of findMatches(pm.doc, query).matches.reverse()) replaceMatch(tr, match, replacementText(match, '$1-$2/$&/$$', true))
    expect(bridge.prepare(tr.doc).source).toBe(expected)
  })
  it('replaces zero width matches in Live once per original position', () => {
    const bridge = new MarkdownSourceBridge('ab\nab'), state = PMState.create({ doc: bridge.doc })
    const tr = state.tr
    for (const match of findMatches(state.doc, options({ search: '^', regexp: true })).matches.reverse()) replaceMatch(tr, match, 'X')
    expect(bridge.prepare(tr.doc).source).toBe('Xab\nXab')
  })
})
describe('UI typography migration preserves independent preferences', () => {
  it('defaults to 14; migrates v4 without re-triggering autosave provenance', () => {
    const old = { settingsVersion: 4, fontSize: 17, theme: 'dark', autoSave: true, markdownTypography: { fontSize: 19 } }
    const migrated = settingsFrom(old)
    expect(defaultSettings().uiFontSize).toBe(14)
    expect(migrated).toMatchObject({ uiFontSize: 14, fontSize: 17, theme: 'dark', autoSave: true, legacyAutoSaveNotice: false, settingsVersion: 5, markdownTypography: { fontSize: 19 } })
    expect(settingsFrom(persistedSettings({ ...migrated, uiFontSize: 16 }))).toEqual({ ...migrated, uiFontSize: 16 })
  })
  it.each([null, '16', 11, 21, 14.5, Infinity, NaN])('rejects invalid UI size %s', value => {
    expect(settingsFrom({ uiFontSize: value, fontSize: 17 }).uiFontSize).toBe(14)
    expect(settingsFrom({ uiFontSize: value, fontSize: 17 }).fontSize).toBe(17)
  })
  it.each([12, 14, 16, 20])('keeps virtual row offsets correct at %s px', size => {
    const height = size + 14, window = treeWindow(10000, 5000, 780, height)
    expect(window.before + window.after + window.count * height).toBe(10000 * height)
    expect(window.count).toBeGreaterThanOrEqual(Math.ceil(780 / height))
  })
})
