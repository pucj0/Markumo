export interface MenuCommand {
  id: string; title: string; shortcut?: string; detail?: string
  enabled: boolean; visible?: boolean; run: () => void | Promise<void>
}
export class CommandRegistry {
  private readonly commands = new Map<string, MenuCommand>()
  constructor(commands: readonly MenuCommand[]) {
    for (const command of commands) {
      if (this.commands.has(command.id)) throw new Error(`重复命令：${command.id}`)
      this.commands.set(command.id, command)
    }
  }
  get(id: string) { return this.commands.get(id) }
  execute(id: string) {
    const command = this.get(id)
    if (!command?.enabled || command.visible === false) return false
    const result = command.run()
    return result instanceof Promise ? result.then(() => true) : true
  }
}
type MenuBase = { id: string; visible?: boolean; enabled?: boolean }
type CommandNode = MenuBase & { commandId: string; label?: string }
export type MenuNode =
  | (CommandNode & { type: 'command' })
  | (CommandNode & { type: 'checkbox'; checked: boolean })
  | (CommandNode & { type: 'radio'; checked: boolean; group: string })
  | (MenuBase & { type: 'submenu'; label: string; children: MenuNode[] })
  | (MenuBase & { type: 'separator' })
export interface MenuGroup { id: string; title: string; items: MenuNode[] }
export interface ResolvedMenuNode {
  id: string; type: MenuNode['type']; title: string; enabled: boolean
  commandId?: string; checked?: boolean; shortcut?: string; detail?: string; children?: ResolvedMenuNode[]
}
export function resolveMenu(nodes: readonly MenuNode[], registry: CommandRegistry): ResolvedMenuNode[] {
  const result: ResolvedMenuNode[] = []
  for (const node of nodes) {
    if (node.visible === false) continue
    if (node.type === 'separator') { if (result.length && result[result.length - 1].type !== 'separator') result.push({ id:node.id,type:node.type,title:'',enabled:false }); continue }
    if (node.type === 'submenu') {
      const children = resolveMenu(node.children,registry)
      result.push({id:node.id,type:node.type,title:node.label,enabled:node.enabled !== false && !!children.length,children})
    } else {
      const command = registry.get(node.commandId)
      if (command?.visible === false) continue
      result.push({id:node.id,type:node.type,title:node.label || command?.title || node.commandId,commandId:node.commandId,
        enabled:node.enabled !== false && !!command?.enabled,checked:node.type === 'checkbox' || node.type === 'radio' ? node.checked : undefined,
        shortcut:command?.shortcut,detail:command?.detail})
    }
  }
  if (result[result.length - 1]?.type === 'separator') result.pop()
  return result
}
export const menuCommand = (id: string, label?: string): MenuNode => ({type:'command',id,commandId:id,label})
export const separator = (id: string): MenuNode => ({type:'separator',id})
export const recentFileCommand = (path: string) => `recent-file:${path}`
export const recentWorkspaceCommand = (path: string) => `recent-workspace:${path}`
