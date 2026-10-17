import type { KeybindingConflict, KeybindingScope } from './contracts'
import { allCommands, commandMap } from './definitions'
import { commandsOverlap, intentionalOverlap, effectiveBindings } from './resolver'
import { normalizeKeybinding } from './normalizer'

// 浏览器/系统硬性保留键（不能由应用随意重定义）
export const reservedSystemKeys = new Set([
  'F5',
  'Mod+Shift+R',
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
  const left = allCommands.filter(command => command.scope === scopeA)
  const right = allCommands.filter(command => command.scope === scopeB)
  if (!left.length || !right.length) return scopeA === 'dialog' || scopeB === 'dialog'
  return !left.some(a => right.some(b => commandsOverlap(a.id,b.id)))
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
  newBinding = normalizeKeybinding(newBinding) || newBinding

  // 1. 系统/编辑器核心保留键
  if (reservedSystemKeys.has(newBinding)) {
    return {
      commandId: targetCommandId,
      commandLabel: commandMap.get(targetCommandId)?.label || targetCommandId,
      category: commandMap.get(targetCommandId)?.category || 'general',
      scope: commandMap.get(targetCommandId)?.scope || 'global',
      binding: newBinding,
      conflictType: 'reserved-key',
      description: `按键 ${newBinding} 为操作系统或剪贴板/刷新保留键，不可占用`,
    }
  }


  const owners = Object.keys(currentBindings).filter(id=>id !== targetCommandId && effectiveBindings(id,currentBindings).includes(newBinding) && commandsOverlap(targetCommandId,id))
  if (!owners.length) return null
  const command = commandMap.get(owners[0])!
  return {
    commandId:command.id, commandIds:owners, commandLabel:command.label,
    category:command.category,scope:command.scope,binding:newBinding,conflictType:'exact-same-scope',
    description:'该按键已分配给'+owners.map(id=>'【'+commandMap.get(id)!.label+'】').join('、')+'；重新分配将解除这些重叠绑定',
  }
}
export function isPriorityConflict(id:string, conflict:KeybindingConflict, binding:string) {
  return (conflict.commandIds || [conflict.commandId]).every(other=>intentionalOverlap(id,other,binding))
}

/** Preset validation uses the same overlap rules as recording and execution. */
export function validatePresetConflicts(bindings: Record<string,string>): string[] {
  const errors = new Set<string>()
  for (const command of allCommands) {
    const binding = bindings[command.id]
    if (!binding) continue
    const conflict = checkBindingConflict(command.id,binding,bindings)
    if (conflict && !isPriorityConflict(command.id,conflict,binding)) errors.add(command.label + '：' + conflict.description)
  }
  return [...errors]
}
