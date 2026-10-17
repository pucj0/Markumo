export type KeybindingScope =
  | 'global'
  | 'workspace'
  | 'editor'
  | 'markdown-live'
  | 'markdown-source'
  | 'code-block'
  | 'table'
  | 'dialog'
  | 'text-input'

export type CommandCategory =
  | 'general'
  | 'file'
  | 'edit'
  | 'search'
  | 'navigation'
  | 'split'
  | 'markdown'
  | 'view'

export const categoryLabels: Record<CommandCategory, string> = {
  general: '通用',
  file: '文件',
  edit: '编辑',
  search: '搜索',
  navigation: '导航',
  split: '分栏',
  markdown: 'Markdown',
  view: '视图',
}

export type KeymapPresetId = 'markumo' | 'fleet' | 'typora'

export interface KeybindingCommand {
  id: string
  label: string
  category: CommandCategory
  description: string
  scope: KeybindingScope
  defaultBinding?: string
  repeatable?: boolean
  userOverridable?: boolean
  when?: string
}

export interface KeybindingConflict {
  commandId: string
  commandLabel: string
  category: CommandCategory
  scope: KeybindingScope
  binding: string
  conflictType: 'exact-same-scope' | 'cross-scope-compatible' | 'reserved-key'
  description?: string
}
