import { invoke, isTauri } from '@tauri-apps/api/core'
import type { MarkdownMode, ThemePreference } from '../../types'
import { defaultKeymap, historyKeymap } from '@codemirror/commands'
import { searchKeymap } from '@codemirror/search'
import { foldKeymap } from '@codemirror/language'
import { defaultImageRules, imageRulesFrom, type ImageRules } from '../../editor/markdown/imageImport'
import { completionKeymap, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultMarkdownTypography, type MarkdownTypography } from '../../editor/markdown/wysiwyg/contracts'
export const defaultShortcuts = {
  new: 'Mod+N', open: 'Mod+O', save: 'Mod+S', 'save-as': 'Mod+Shift+S',
  palette: 'Mod+Shift+P', 'quick-open': 'Mod+P', find: 'Mod+F', replace: 'Mod+R',
  'find-next': 'F3', 'find-previous': 'Shift+F3', 'goto-line': 'Mod+G',
  'split-editor': 'Mod+\\', 'switch-pane': 'Mod+Alt+ArrowRight', sidebar: 'Mod+Alt+B', explorer:'Alt+1',
  bold:'Mod+B', italic:'Mod+I', 'close-current':'Mod+W',
  'workspace-search': 'Mod+Shift+F', 'zoom-in': 'Mod+=', 'zoom-out': 'Mod+-', 'zoom-reset': 'Mod+0',
  undo: 'Mod+Z', redo: 'Mod+Y', uppercase: 'Mod+Alt+U', lowercase: 'Mod+Alt+L',
} as const
export type ShortcutAction = keyof typeof defaultShortcuts
export const shortcutLabels: Record<ShortcutAction, string> = {
  new: '新建文档', open: '打开文件', save: '保存文件', 'save-as': '另存为', palette: '命令面板', 'quick-open': '快速打开',
  find: '查找', replace: '替换', 'find-next': '查找下一个', 'find-previous': '查找上一个', 'goto-line': '转到行',
  'split-editor': '切换分栏', 'switch-pane': '切换窗格', sidebar: '切换侧边栏', 'workspace-search': '工作区搜索',
  bold:'Markdown 加粗', italic:'Markdown 斜体', 'close-current':'关闭文件',
  explorer:'资源管理器',
  'zoom-in': '放大字号', 'zoom-out': '缩小字号', 'zoom-reset': '恢复默认字号', undo: '撤销', redo: '重做', uppercase: '转为大写', lowercase: '转为小写',
}
/** Bumped when a stored preference needs migration. Version 4 made automatic
 * save opt-in: files written by older versions always stored the old `true`
 * default, so that value cannot prove intent. */
export const currentSettingsVersion = 4
export interface EditorSettings {
  markdownTypography:MarkdownTypography
  theme: ThemePreference; fontSize: number; fontFamily: 'system' | 'consolas' | 'cascadia'
  wordWrap: boolean; showOutline: boolean; indentSize: number; useTabs: boolean; defaultMdMode: MarkdownMode
  autoSave: boolean; autoSaveDelay: number
  imageRules: ImageRules
  documentImageRules: Record<string, ImageRules>
  settingsVersion: number
  /** Transient migration notice for the UI. Never persisted. */
  legacyAutoSaveNotice: boolean
  shortcutVersion: number
  customShortcuts: ShortcutAction[]
  shortcuts: Record<ShortcutAction, string>; fileModes: Record<string, MarkdownMode>
}
export const fontFamilies = { system: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', consolas: 'Consolas, monospace', cascadia: '"Cascadia Code", Consolas, monospace' }
export function defaultSettings(): EditorSettings {
  return { markdownTypography:defaultMarkdownTypography(), theme: 'system', fontSize: 14, fontFamily: 'system', wordWrap: false, showOutline: false, indentSize: 2, useTabs: false, defaultMdMode: 'live', autoSave: false, autoSaveDelay: 1500, imageRules: defaultImageRules(), documentImageRules: {}, settingsVersion: currentSettingsVersion, legacyAutoSaveNotice: false, shortcutVersion: 3, customShortcuts:[], shortcuts: { ...defaultShortcuts }, fileModes: {} }
}
/** Drop the transient migration notice before writing preferences to disk. */
export function persistedSettings(settings: EditorSettings) {
  const { legacyAutoSaveNotice: _transient, ...persisted } = settings
  return persisted
}
export function normalizeShortcut(raw: string) {
  const parts = raw.trim().split('+'), key = parts.pop() || ''
  const mods = ['Mod', 'Alt', 'Shift'].filter(mod => parts.some(p => p.toLowerCase() === mod.toLowerCase()))
  if (parts.length !== mods.length || parts.some(p => !['mod','alt','shift'].includes(p.toLowerCase()))) return null
  const normalizedKey = key.length === 1 ? key.toUpperCase() : /^(f[1-9]|f1[0-2])$/i.test(key) ? key.toUpperCase() : key.toLowerCase() === 'arrowright' ? 'ArrowRight' : ''
  if (!normalizedKey || (!mods.includes('Mod') && !/^F\d+$/.test(normalizedKey) && !(mods.includes('Alt') && /^[1-9]$/.test(normalizedKey)))) return null
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
// Keep explicitly configured legacy replacement shortcuts available.
reservedEditorKeys.delete('Mod+H')
export function settingsFrom(raw: unknown): EditorSettings {
  const defaults = defaultSettings()
  if (!raw || typeof raw !== 'object') return defaults
  const s = raw as Partial<EditorSettings>
  if(s.markdownTypography&&typeof s.markdownTypography==='object'){
    const md=s.markdownTypography,target=defaults.markdownTypography
    if(Number.isFinite(md.width)&&md.width>=480&&md.width<=1400)target.width=md.width
    if(Number.isFinite(md.fontSize)&&md.fontSize>=12&&md.fontSize<=28)target.fontSize=md.fontSize
    if(Number.isFinite(md.lineHeight)&&md.lineHeight>=1.2&&md.lineHeight<=2.4)target.lineHeight=md.lineHeight
    if(['system','serif','mono'].includes(md.fontFamily))target.fontFamily=md.fontFamily
    if(typeof md.codeLineNumbers==='boolean')target.codeLineNumbers=md.codeLineNumbers
    if(typeof md.codeWrap==='boolean')target.codeWrap=md.codeWrap
  }
  defaults.imageRules = imageRulesFrom(s.imageRules)
  if (s.documentImageRules && typeof s.documentImageRules === 'object') for (const [path,rules] of Object.entries(s.documentImageRules).slice(-100)) {
    if (path && path.length <= 4096 && !['__proto__','constructor','prototype'].includes(path)) Object.defineProperty(defaults.documentImageRules,path,{value:imageRulesFrom(rules),enumerable:true,configurable:true,writable:true})
  }
  if (s.theme === 'dark' || s.theme === 'light' || s.theme === 'system') defaults.theme = s.theme
  if (Number.isInteger(s.fontSize) && s.fontSize! >= 10 && s.fontSize! <= 24) defaults.fontSize = s.fontSize!
  if (s.fontFamily && ['system','consolas','cascadia'].includes(s.fontFamily)) defaults.fontFamily = s.fontFamily
  for (const key of ['wordWrap','showOutline','useTabs'] as const) if (typeof s[key] === 'boolean') defaults[key] = s[key]!
  // Automatic save is opt-in. A file written by an older version could not
  // record who enabled it, so an ambiguous legacy `true` is preserved (never
  // overwritten) and surfaced as a one-time notice instead. From version 4 on,
  // the stored value is written only by the settings UI and is authoritative.
  const legacySettings = !(Number.isInteger(s.settingsVersion) && s.settingsVersion! >= currentSettingsVersion)
  if (typeof s.autoSave === 'boolean') {
    defaults.autoSave = s.autoSave
    defaults.legacyAutoSaveNotice = legacySettings && s.autoSave
  } else if (legacySettings && s.autoSave !== undefined) {
    // A non-boolean legacy value is corrupt; fall back to the new safe default.
    defaults.legacyAutoSaveNotice = false
  }
  if (Number.isInteger(s.autoSaveDelay) && s.autoSaveDelay! >= 500 && s.autoSaveDelay! <= 10000) defaults.autoSaveDelay = s.autoSaveDelay!
  if (Number.isInteger(s.indentSize) && s.indentSize! >= 1 && s.indentSize! <= 8) defaults.indentSize = s.indentSize!
  if (['live','source','split'].includes(s.defaultMdMode || '')) defaults.defaultMdMode = s.defaultMdMode!
  const shortcuts = { ...defaults.shortcuts, ...s.shortcuts }
  for (const id of Object.keys(defaultShortcuts) as ShortcutAction[]) {
    if (typeof shortcuts[id] === 'string') shortcuts[id] = normalizeShortcut(shortcuts[id]) || shortcuts[id]
  }
  const version = s.shortcutVersion || 1
  const legacyDefaults = { ...defaultShortcuts, sidebar:'Mod+B', replace:version < 2 ? 'Mod+H' : 'Mod+R' }
  // Old files have no per-key customization provenance. Migrate an untouched
  // old default map; preserve ambiguous/custom maps rather than overwrite intent.
  const explicit = new Set<ShortcutAction>(Array.isArray(s.customShortcuts) ? s.customShortcuts.filter(id => Object.prototype.hasOwnProperty.call(defaultShortcuts,id)) : [])
  const untouched = !explicit.size && Object.entries(s.shortcuts || {}).every(([id, value]) => legacyDefaults[id as ShortcutAction] === value)
  if (version < 2 && untouched && shortcuts.replace === 'Mod+H') shortcuts.replace = 'Mod+R'
  if (version < 3 && untouched && shortcuts.sidebar === 'Mod+B') shortcuts.sidebar = defaultShortcuts.sidebar
  if (version < 3 && !untouched) for (const id of Object.keys(s.shortcuts || {})) if (id in defaultShortcuts) explicit.add(id as ShortcutAction)
  // Preserve old user keys. Newly introduced commands take an available key.
  for (const id of ['bold','italic','close-current','explorer'] as const) {
    if (s.shortcuts?.[id] !== undefined) continue
    const occupied = new Set(Object.entries(shortcuts).filter(([key])=>key!==id).map(([,value])=>value))
    if (occupied.has(shortcuts[id])) {
      const key = id === 'bold' ? 'B' : id === 'italic' ? 'I' : id === 'explorer' ? '1' : 'W'
      const alternatives = [key,...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',...Array.from({length:12},(_,i)=>`F${i+1}`)]
      const candidates = [`Mod+Alt+${key}`,`Mod+Shift+${key}`,`Mod+Alt+Shift+${key}`,...alternatives.flatMap(other=>[`Mod+Alt+${other}`,`Mod+Alt+Shift+${other}`])]
      const free = candidates.find(value=>!occupied.has(value)&&!reservedEditorKeys.has(value))
      if (free) shortcuts[id] = free
    }
  }
  defaults.customShortcuts = [...explicit]
  if (!validateShortcuts(shortcuts)) defaults.shortcuts = Object.fromEntries(Object.entries(shortcuts).filter(([id]) => Object.prototype.hasOwnProperty.call(defaultShortcuts,id)).map(([id,key]) => [id,normalizeShortcut(key)!])) as EditorSettings['shortcuts']
  for (const [path,mode] of Object.entries(s.fileModes || {}).slice(-100)) if (path.length <= 4096 && ['live','source','split'].includes(mode)) defaults.fileModes[path] = mode
  return defaults
}
export function macPlatform(platform = globalThis.navigator?.platform || '') { return /Mac|iPhone|iPad/i.test(platform) }
export function shortcutLabel(key: string, platform?: string) {
  return macPlatform(platform) ? key.replace('Mod','⌘').replace('Alt','⌥').replace('Shift','⇧').replace(/\+/g,' ') : key.replace('Mod','Ctrl')
}
export function eventShortcut(event: KeyboardEvent, platform?: string) {
  const key = event.altKey && /^Digit[1-9]$/.test(event.code) ? event.code.slice(-1) : event.key === '+' ? '=' : event.key === '|' ? '\\' : event.key === '_' ? '-' : event.key.length === 1 ? event.key.toUpperCase() : event.key
  const mod = macPlatform(platform) ? event.metaKey : event.ctrlKey
  const extra = macPlatform(platform) ? event.ctrlKey ? 'Ctrl' : '' : event.metaKey ? 'Meta' : ''
  return [mod ? 'Mod' : '', extra, event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+')
}
export async function loadEditorSettings(): Promise<EditorSettings> {
  return settingsFrom(isTauri() ? await invoke('load_editor_settings') : JSON.parse(localStorage.getItem('lightedit.settings.v1') || 'null'))
}
export async function saveEditorSettings(settings: EditorSettings) {
  const payload = persistedSettings(settings)
  if (isTauri()) await invoke('save_editor_settings', { settings: payload })
  else localStorage.setItem('lightedit.settings.v1', JSON.stringify(payload))
}
export function relativeFilePath(path: string, root: string | null) {
  if (!root) return path
  const normalized = path.replace(/\\/g, '/'), boundary = root.replace(/\\/g,'/').replace(/\/$/, '') + '/'
  const windows = /^[a-z]:\//i.test(boundary) || boundary.startsWith('//')
  if ((windows ? normalized.toLowerCase() : normalized).startsWith(windows ? boundary.toLowerCase() : boundary)) return normalized.slice(boundary.length)
  return path
}
