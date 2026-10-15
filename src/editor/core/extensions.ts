import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine, keymap } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { tags } from '@lezer/highlight'
import type { Theme } from '../../types'
import { createEditorSearchPanel, showEditorSearch } from './searchPanel'
import { changeGutter } from './changeGutter'

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier], color: 'var(--pink)' },
  { tag: [tags.string, tags.inserted], color: 'var(--green)' },
  { tag: tags.comment, color: 'var(--muted)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--yellow)' },
  { tag: [tags.typeName, tags.tagName, tags.propertyName], color: 'var(--blue)' },
  { tag: tags.heading, color: 'var(--accent)', fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
])

export const coreExtensions: Extension = [
  changeGutter, lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(),
  drawSelection(), dropCursor(), rectangularSelection(), crosshairCursor(), highlightActiveLine(),
  EditorState.allowMultipleSelections.of(true),
  EditorState.phrases.of({ 'Find': '查找', 'Replace': '替换', 'next': '下一个', 'previous': '上一个', 'all': '全部', 'match case': '区分大小写', 'regexp': '正则', 'by word': '全词', 'replace': '替换', 'replace all': '全部替换', 'close': '关闭' }),
  indentOnInput(), bracketMatching(), foldGutter({ markerDOM(open) {
    const element = document.createElement('span'); element.className = 'cm-fold-chevron' + (open ? ' open' : '')
    element.setAttribute('aria-label', open ? '折叠代码' : '展开代码'); return element
  } }), syntaxHighlighting(highlight),
  closeBrackets(), autocompletion(), search({ top: true, createPanel: createEditorSearchPanel }),
  keymap.of([{ key: 'Mod-f', run: view => showEditorSearch(view, false) }, { key: 'Mod-r', run: view => showEditorSearch(view, true) },
    ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap.filter(binding => binding.key !== 'Mod-h'), ...foldKeymap, ...completionKeymap, indentWithTab]),
]

export function editorTheme(theme: Theme) {
  return EditorView.theme({
    '&': { height: '100%', backgroundColor: 'var(--editor)', color: 'var(--ink)', fontSize: 'var(--editor-size)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: 'var(--editor-line)', overflow: 'auto' },
    '.cm-content': { padding: '12px 0', caretColor: 'var(--bright)', userSelect: 'text' },
    '.cm-line': { padding: '0 18px' },
    '.cm-gutters': { backgroundColor: 'var(--editor)', color: 'var(--muted)', borderRight: '1px solid var(--line)' },
    // drawSelection paints below the text; an opaque active line hides that layer.
    '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--soft)' },
    '&.cm-editor > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--selection-inactive)' },
    '&.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--selection)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--bright)' },
    '.cm-panels, .cm-tooltip': { backgroundColor: 'var(--paper)', color: 'var(--ink)', borderColor: 'var(--line)' },
    '.cm-searchMatch': { backgroundColor: 'var(--accentbg)', outline: '1px solid var(--accent)' },
    '.cm-searchMatch-selected': { backgroundColor: 'var(--accentbg)' },
    '.cm-foldPlaceholder': { backgroundColor: 'var(--soft)', color: 'var(--sub)', borderColor: 'var(--line)' },
    '.cm-foldGutter .cm-gutterElement': { padding: '0 2px', width: '16px', boxSizing: 'border-box' },
    '.cm-fold-chevron': { display: 'inline-block', width: '12px', height: '12px', position: 'relative', color: 'var(--muted)', transform: 'rotate(0deg)', transition: 'transform .12s' },
    '.cm-fold-chevron:after': { content: "''", position: 'absolute', width: '5px', height: '5px', top: '3px', left: '2px', borderTop: '1.5px solid currentColor', borderRight: '1.5px solid currentColor', transform: 'rotate(45deg)' },
    '.cm-fold-chevron.open': { transform: 'rotate(90deg)' },
    '.cm-fold-chevron:hover': { color: 'var(--bright)' },
  }, { dark: theme === 'dark' })
}
