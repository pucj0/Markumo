import type { KeybindingConflict, KeybindingScope } from './contracts'
import { commandMap } from './definitions'

// 浏览器/系统硬性保留键（不能由应用随意重定义）
export const reservedSystemKeys = new Set([
  'F5',
  'Mod+Shift+R',
  'Mod+Shift+I', // 开发者工具（调试保留）
  'Mod+C',
  'Mod+V',
  'Mod+X',
  'Mod+A',
])

/**
 * 判断两个作用域是否互斥（若互斥，即使快捷键相同也可共存）
 */
export function areScopesMutuallyExclusive(scopeA: KeybindingScope, scopeB: KeybindingScope): boolean {
  if (scopeA === scopeB) return false

  // markdown-live 与 editor/markdown-source 互斥
  if (
    (scopeA === 'markdown-live' && (scopeB === 'editor' || scopeB === 'markdown-source')) ||
    (scopeB === 'markdown-live' && (scopeA === 'editor' || scopeA === 'markdown-source'))
  ) {
    return true
  }

  // 对话框与普通编辑互斥
  if (scopeA === 'dialog' || scopeB === 'dialog') {
    return true
  }

  return false
}

/**
 * 检测当前绑定的冲突情况
 */
export function checkBindingConflict(
  targetCommandId: string,
  newBinding: string,
  currentBindings: Record<string, string>
): KeybindingConflict | null {
  if (!newBinding) return null

  // 1. 系统/编辑器核心保留键
  if (reservedSystemKeys.has(newBinding)) {
    return {
      commandId: targetCommandId,
      commandLabel: commandMap.get(targetCommandId)?.label || targetCommandId,
      category: commandMap.get(targetCommandId)?.category || 'general',
      scope: commandMap.get(targetCommandId)?.scope || 'global',
      binding: newBinding,
      conflictType: 'reserved-key',
      description: `按键 ${newBinding} 为操作系统或剪贴板/开发者工具保留键，不可占用`,
    }
  }

  const targetCmd = commandMap.get(targetCommandId)
  const targetScope = targetCmd?.scope || 'global'

  // 2. 检查与其他命令的绑定
  for (const [cmdId, binding] of Object.entries(currentBindings)) {
    if (cmdId === targetCommandId) continue
    if (binding === newBinding) {
      const otherCmd = commandMap.get(cmdId)
      const otherScope = otherCmd?.scope || 'global'

      // 判断作用域是否严格冲突
      if (!areScopesMutuallyExclusive(targetScope, otherScope)) {
        return {
          commandId: cmdId,
          commandLabel: otherCmd?.label || cmdId,
          category: otherCmd?.category || 'general',
          scope: otherScope,
          binding: newBinding,
          conflictType: 'exact-same-scope',
          description: `该按键已分配给【${otherCmd?.label || cmdId}】`,
        }
      }
    }
  }

  return null
}
