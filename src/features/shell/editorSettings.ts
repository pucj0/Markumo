import { invoke, isTauri } from '@tauri-apps/api/core'
import type { MarkdownMode, ThemePreference } from '../../types'
import { defaultKeymap, historyKeymap } from '@codemirror/commands'
import { searchKeymap } from '@codemirror/search'
import { foldKeymap } from '@codemirror/language'
import { completionKeymap, closeBracketsKeymap } from '@codemirror/autocomplete'
export const defaultShortcuts = {
  new: 'Mod+N', open: 'Mod+O', save: 'Mod+S', 'save-as': 'Mod+Shift+S',
  palette: 'Mod+Shift+P', 'quick-open': 'Mod+P', find: 'Mod+F', replace: 'Mod+H',
  'find-next': 'F3', 'find-previous': 'Shift+F3', 'goto-line': 'Mod+G',
  'split-editor': 'Mod+\\', 'switch-pane': 'Mod+Alt+ArrowRight', sidebar: 'Mod+B',
  'workspace-search': 'Mod+Shift+F', 'zoom-in': 'Mod+=', 'zoom-out': 'Mod+-', 'zoom-reset': 'Mod+0',
  undo: 'Mod+Z', redo: 'Mod+Y', uppercase: 'Mod+Alt+U', lowercase: 'Mod+Alt+L',
} as const
export type ShortcutAction = keyof typeof defaultShortcuts
export const shortcutLabels: Record<ShortcutAction, string> = {
  new: '新建文档', open: '打开文件', save: '保存文件', 'save-as': '另存为', palette: '命令面板', 'quick-open': '快速打开',
  find: '查找', replace: '替换', 'find-next': '查找下一个', 'find-previous': '查找上一个', 'goto-line': '转到行',
  'split-editor': '切换分栏', 'switch-pane': '切换窗格', sidebar: '切换侧边栏', 'workspace-search': '工作区搜索',
  'zoom-in': '放大字号', 'zoom-out': '缩小字号', 'zoom-reset': '恢复默认字号', undo: '撤销', redo: '重做', uppercase: '转为大写', lowercase: '转为小写',
}
export interface EditorSettings {
  theme: ThemePreference; fontSize: number; fontFamily: 'system' | 'consolas' | 'cascadia'
  wordWrap: boolean; showOutline: boolean; indentSize: number; useTabs: boolean; defaultMdMode: MarkdownMode
  autoSave: boolean; autoSaveDelay: number
  shortcuts: Record<ShortcutAction, string>; fileModes: Record<string, MarkdownMode>
}
export const fontFamilies = { system: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', consolas: 'Consolas, monospace', cascadia: '"Cascadia Code", Consolas, monospace' }
export function defaultSettings(): EditorSettings {
  return { theme: 'system', fontSize: 14, fontFamily: 'system', wordWrap: false, showOutline: false, indentSize: 2, useTabs: false, defaultMdMode: 'live', autoSave: true, autoSaveDelay: 1500, shortcuts: { ...defaultShortcuts }, fileModes: {} }
}
export function normalizeShortcut(raw: string) {
  const parts = raw.trim().split('+'), key = parts.pop() || ''
  const mods = ['Mod', 'Alt', 'Shift'].filter(mod => parts.some(p => p.toLowerCase() === mod.toLowerCase()))
  if (parts.length !== mods.length || parts.some(p => !['mod','alt','shift'].includes(p.toLowerCase()))) return null
  const normalizedKey = key.length === 1 ? key.toUpperCase() : /^(f[1-9]|f1[0-2])$/i.test(key) ? key.toUpperCase() : key.toLowerCase() === 'arrowright' ? 'ArrowRight' : ''
  if (!normalizedKey || (!mods.includes('Mod') && !/^F\d+$/.test(normalizedKey))) return null
  return [...mods, normalizedKey].join('+')
}
export function validateShortcuts(shortcuts: Record<string, string>): string | null {
  const used = new Set<string>()
  for (const id of Object.keys(defaultShortcuts)) {
    const raw = shortcuts[id], key = typeof raw === 'string' ? normalizeShortcut(raw) : null
    if (!key) return `无效快捷键：${shortcutLabels[id as ShortcutAction]}（使用 Mod、Alt、Shift 和按键）`
    if (['Mod+C','Mod+V','Mod+X','Mod+A','Mod+Shift+Z','Mod+U','Mod+Shift+U','Mod+D','Mod+Enter','Mod+Shift+K','Mod+/','Mod+Alt+[','Mod+Alt+]','Mod+Shift+[','Mod+Shift+]'].includes(key)) return `快捷键 ${key} 已被编辑器保留`
    if (reservedEditorKeys.has(key)) return `快捷键 ${key} 已被编辑器保留`
    if (used.has(key)) return `快捷键 ${key} 重复`
    used.add(key)
  }
  return null
}
const reservedEditorKeys = new Set<string>()
for (const binding of [...defaultKeymap,...historyKeymap,...searchKeymap,...foldKeymap,...completionKeymap,...closeBracketsKeymap]) {
  for (const raw of [binding.key,binding.mac,binding.win,binding.linux]) {
    if (!raw) continue
    const shortcut = normalizeShortcut(raw.replace(/^(Ctrl|Meta)-/, 'Mod-').replace(/-/g,'+'))
    if (shortcut && !Object.values(defaultShortcuts).includes(shortcut as typeof defaultShortcuts[ShortcutAction])) reservedEditorKeys.add(shortcut)
    if (shortcut && binding.shift) {
      const shifted = normalizeShortcut('Shift+' + shortcut)
      if (shifted && !Object.values(defaultShortcuts).includes(shifted as typeof defaultShortcuts[ShortcutAction])) reservedEditorKeys.add(shifted)
    }
  }
}
export function settingsFrom(raw: unknown): EditorSettings {
  const defaults = defaultSettings()
  if (!raw || typeof raw !== 'object') return defaults
  const s = raw as Partial<EditorSettings>
  if (s.theme === 'dark' || s.theme === 'light' || s.theme === 'system') defaults.theme = s.theme
  if (Number.isInteger(s.fontSize) && s.fontSize! >= 10 && s.fontSize! <= 24) defaults.fontSize = s.fontSize!
  if (s.fontFamily && ['system','consolas','cascadia'].includes(s.fontFamily)) defaults.fontFamily = s.fontFamily
  for (const key of ['wordWrap','showOutline','useTabs','autoSave'] as const) if (typeof s[key] === 'boolean') defaults[key] = s[key]!
  if (Number.isInteger(s.autoSaveDelay) && s.autoSaveDelay! >= 500 && s.autoSaveDelay! <= 10000) defaults.autoSaveDelay = s.autoSaveDelay!
  if (Number.isInteger(s.indentSize) && s.indentSize! >= 1 && s.indentSize! <= 8) defaults.indentSize = s.indentSize!
  if (['live','source','split'].includes(s.defaultMdMode || '')) defaults.defaultMdMode = s.defaultMdMode!
  const shortcuts = { ...defaults.shortcuts, ...s.shortcuts }
  if (!validateShortcuts(shortcuts)) defaults.shortcuts = Object.fromEntries(Object.entries(shortcuts).filter(([id]) => Object.prototype.hasOwnProperty.call(defaultShortcuts,id)).map(([id,key]) => [id,normalizeShortcut(key)!])) as EditorSettings['shortcuts']
  for (const [path,mode] of Object.entries(s.fileModes || {}).slice(-100)) if (path.length <= 4096 && ['live','source','split'].includes(mode)) defaults.fileModes[path] = mode
  return defaults
}
export function eventShortcut(event: KeyboardEvent) {
  const key = event.key === '+' ? '=' : event.key === '|' ? '\\' : event.key === '_' ? '-' : event.key.length === 1 ? event.key.toUpperCase() : event.key
  return [event.ctrlKey || event.metaKey ? 'Mod' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+')
}
export async function loadEditorSettings(): Promise<EditorSettings> {
  return settingsFrom(isTauri() ? await invoke('load_editor_settings') : JSON.parse(localStorage.getItem('lightedit.settings.v1') || 'null'))
}
export async function saveEditorSettings(settings: EditorSettings) {
  if (isTauri()) await invoke('save_editor_settings', { settings })
  else localStorage.setItem('lightedit.settings.v1', JSON.stringify(settings))
}
export function relativeFilePath(path: string, root: string | null) {
  if (!root) return path
  const normalized = path.replace(/\\/g, '/'), boundary = root.replace(/\\/g,'/').replace(/\/$/, '') + '/'
  const windows = /^[a-z]:\//i.test(boundary) || boundary.startsWith('//')
  if ((windows ? normalized.toLowerCase() : normalized).startsWith(windows ? boundary.toLowerCase() : boundary)) return normalized.slice(boundary.length)
  return path
}
