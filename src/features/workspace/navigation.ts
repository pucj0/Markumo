import type { InjectionKey } from 'vue'
import type { WorkspaceController } from './WorkspaceController'
import type { WorkspaceInfo, WorkspaceNode } from './contracts'
import { displayPathKey, readablePath } from '../shell/pathDisplay'
import { tabLabels } from '../tabs/tabLabels'

export interface WorkspaceNavigation {
  workspace: WorkspaceController
  enabled: () => boolean
  reveal: (path: string) => Promise<boolean>
}
export const workspaceNavigationKey: InjectionKey<WorkspaceNavigation> = Symbol('workspace-navigation')
export interface PathCrumb { name: string; path: string; directory: boolean }
const normalized = (path: string) => {
  const value=readablePath(path).replace(/\\/g,'/')
  return value==='/'||/^[a-z]:\/$/i.test(value)?value:value.replace(/\/$/,'')
}
function validPath(path: string) {
  return /^(?:[a-z]:\/|\/)/i.test(path) && !/[\x00-\x1f]/.test(path) && !path.split('/').some(part => part === '.' || part === '..')
}
export function navigationParent(path: string, root: string | null): string | undefined {
  const full=normalized(path)
  if(!root||!validPath(full)||displayPathKey(full)===displayPathKey(root))return
  const parent=full.slice(0,full.lastIndexOf('/')) || '/'
  return displayPathKey(parent)===displayPathKey(root)?root:parent
}

/** Presentation is bounded by actual workspace roots. These strings grant no I/O rights. */
export function pathCrumbs(path: string, roots: readonly WorkspaceInfo[]): PathCrumb[] {
  const full = normalized(path)
  if (!validPath(full)) return []
  const key = displayPathKey(full)
  const root = [...roots].sort((a,b) => b.rootPath.length-a.rootPath.length).find(root => key.startsWith(displayPathKey(root.rootPath).replace(/\/$/, '') + '/'))
  if (!root) return []
  const base = normalized(root.rootPath)
  if (!validPath(base)) return []
  const boundary=base.replace(/\/$/,'')+'/',parts=full.slice(boundary.length).split('/')
  if (parts.length>256||parts.some(part => !part)) return []
  const label=tabLabels(roots.map(root=>({id:root.rootPath,name:root.name,path:root.rootPath}))).get(root.rootPath) || root.name
  return [{ name:label, path: root.rootPath, directory: true }, ...parts.map((name,index) => ({name,path:boundary+parts.slice(0,index+1).join('/'),directory:index<parts.length-1}))]
}

export async function navigationDirectory(workspace: WorkspaceController, path: string): Promise<{nodes: WorkspaceNode[]; limited: boolean}> {
  const root = workspace.rootForPath(path), key = displayPathKey(path)
  if (!root || !validPath(normalized(path))) throw Error('目录已不在当前工作区中。')
  const generation = workspace.openRevision
  const nodes = await workspace.gateway.readDirectory(path)
  if (generation !== workspace.openRevision || workspace.rootForPath(path) !== root) throw Error('工作区已切换，请重新打开目录。')
  const safe = nodes.filter(node => !node.isSymlink && validPath(normalized(node.path)) && displayPathKey(normalized(node.path).slice(0, normalized(node.path).lastIndexOf('/'))) === key)
  safe.sort((a,b) => Number(b.isDirectory)-Number(a.isDirectory) || a.name.localeCompare(b.name, undefined, {numeric:true}))
  return {nodes:safe.slice(0,1000),limited:safe.length>1000}
}
