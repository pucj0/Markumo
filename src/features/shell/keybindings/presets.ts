import type { KeymapPresetId } from './contracts'
import { allCommands } from './definitions'

export interface KeymapPreset {
  id: KeymapPresetId
  name: string
  description: string
  bindings: Record<string, string>
}

// 1. LightEdit 默认方案（融合当前用户已明确习惯）
const lightEditBindings: Record<string, string> = Object.fromEntries(
  allCommands
    .filter(cmd => cmd.defaultBinding)
    .map(cmd => [cmd.id, cmd.defaultBinding!])
)

// 2. Fleet 风格方案（参考 JetBrains Fleet Windows/Linux Keymap）
const fleetBindings: Record<string, string> = {
  ...lightEditBindings,
  new: 'Mod+N',
  open: 'Mod+O',
  'quick-open': 'Mod+Shift+N',
  palette: 'Mod+Shift+K',
  save: 'Mod+S',
  'save-as': 'Mod+Alt+S',
  'close-current': 'Mod+W',
  explorer: 'Alt+1',
  sidebar: 'Mod+B',
  'workspace-search': 'Mod+Shift+F',
  find: 'Mod+F',
  replace: 'Mod+R',
  'goto-line': 'Mod+G',
  undo: 'Mod+Z',
  redo: 'Mod+Shift+Z',
  'delete-line': 'Mod+Y',
  'copy-line-down': 'Mod+D',
  'move-line-up': 'Alt+Shift+ArrowUp',
  'move-line-down': 'Alt+Shift+ArrowDown',
  'comment-line': 'Mod+/',
  'fold-code': 'Mod+Alt+[',
  'unfold-code': 'Mod+Alt+]',
  'split-editor': 'Mod+\\',
  'next-tab': 'Alt+ArrowRight',
  'previous-tab': 'Alt+ArrowLeft',
  'toggle-focus': 'Mod+Shift+F12',
}

// 3. Typora 风格方案（参考 Typora 官方 Markdown 快捷键）
const typoraBindings: Record<string, string> = {
  ...lightEditBindings,
  new: 'Mod+N',
  open: 'Mod+O',
  'quick-open': 'Mod+P',
  palette: 'Mod+Shift+P',
  save: 'Mod+S',
  'save-as': 'Mod+Shift+S',
  'close-current': 'Mod+W',
  explorer: 'Mod+Shift+L',
  sidebar: 'Mod+Shift+F',
  'goto-line': 'Mod+J',
  bold: 'Mod+B',
  italic: 'Mod+I',
  strike: 'Alt+Shift+5',
  'inline-code': 'Mod+Shift+`',
  link: 'Mod+K',
  image: 'Mod+Shift+I',
  'code-block': 'Mod+Shift+K',
  table: 'Mod+T',
  quote: 'Mod+Shift+Q',
  'heading-1': 'Mod+1',
  'heading-2': 'Mod+2',
  'heading-3': 'Mod+3',
  'heading-4': 'Mod+4',
  'heading-5': 'Mod+5',
  'heading-6': 'Mod+6',
  'heading-0': 'Mod+0',
  'toggle-outline': 'Mod+Shift+1',
  'toggle-focus': 'F8',
}

export const keymapPresets: Record<KeymapPresetId, KeymapPreset> = {
  lightedit: {
    id: 'lightedit',
    name: 'LightEdit 默认 (推荐)',
    description: '融合通用代码编辑与 Markdown 所见即所得排版的平衡方案',
    bindings: lightEditBindings,
  },
  fleet: {
    id: 'fleet',
    name: 'JetBrains Fleet 风格',
    description: '参考 Fleet 官方键位，侧重代码导航、行操作与工具窗口',
    bindings: fleetBindings,
  },
  typora: {
    id: 'typora',
    name: 'Typora 风格',
    description: '参考 Typora 官方键位，侧重 Markdown 标题、表格、行内格式与排版',
    bindings: typoraBindings,
  },
}

export function getPresetBindings(presetId: KeymapPresetId): Record<string, string> {
  return { ...(keymapPresets[presetId] || keymapPresets.lightedit).bindings }
}
