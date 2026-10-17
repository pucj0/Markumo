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
  /** Shell registry entry. Aliases keep persisted command IDs stable. */
  executeId: string
  supported: boolean
  contexts: KeybindingContext[]
  id: string
  label: string
  category: CommandCategory
  description: string
  scope: KeybindingScope
  defaultBinding?: string
  defaultAliases?:string[]
  repeatable: boolean
  userOverridable: boolean
  when?: string
}
export type KeybindingContext = 'shell' | 'text' | 'source' | 'live' | 'code-block' | 'input' | 'search' | 'dialog'

export interface KeybindingConflict {
  commandIds?:string[]
  commandId: string
  commandLabel: string
  category: CommandCategory
  scope: KeybindingScope
  binding: string
  conflictType: 'exact-same-scope' | 'cross-scope-compatible' | 'reserved-key'
  description?: string
}
