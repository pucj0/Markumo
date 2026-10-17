import type { DocumentManager } from '../../editor/core/DocumentManager'
import type { FileController } from '../files/FileController'
import { displayPathKey } from '../shell/pathDisplay'
import { sameFilePath } from '../files/pathKey'
import type {
  SearchDonePayload,
  SearchMatch,
  SearchQuery,
  WorkspaceGateway,
  WorkspaceInfo,
  WorkspaceNode,
} from './contracts'

export interface FileSearchGroup {
  path: string
  relativePath: string
  matches: SearchMatch[]
  isExpanded: boolean
}

export class WorkspaceController {
  rootPath: string | null = null
  rootName = ''
  entries: WorkspaceNode[] = []
  roots: WorkspaceInfo[] = []
  openRevision = 0
  recentWorkspaces: string[] = []
  showIgnored = false
  quickFiles: { name: string; path: string; relativePath: string }[] = []
  private quickGeneration = 0
  private operationBusy = false
  private disposed = false
  private searchSequence = 0
  private revealSequence = 0
  private expandSequence = 0
  private openFileSeq = 0
  private latestPaneSeq = new Map<string, number>()
  private inFlightOpens = new Map<string, { seq: number; preview: boolean; promise: Promise<void> }>()
  private folderLoads = new Map<WorkspaceNode,Promise<boolean>>()
  expanding = false

  // 全文搜索状态
  searchId = ''
  searchQuery = ''
  searching = false
  searchTotal = 0
  searchResults: FileSearchGroup[] = []
  isCaseSensitive = false
  isWholeWord = false
  isRegex = false

  private listeners = new Set<() => void>()
  private searchBatchUnsub: (() => void) | null = null
  private searchDoneUnsub: (() => void) | null = null

  constructor(
    readonly gateway: WorkspaceGateway,
    readonly documentManager: DocumentManager,
    readonly fileController: FileController,
    private readonly notify: (msg: string) => void,
    autoConnect = true,
  ) {
    if (autoConnect) this.connect()
  }

  connect() {
    if (this.searchBatchUnsub || this.disposed) return
    this.searchBatchUnsub = this.gateway.onSearchBatch(batch => this.onSearchBatch(batch))
    this.searchDoneUnsub = this.gateway.onSearchDone(payload => this.onSearchDone(payload))
    void this.loadRecents()
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  async loadRecents() {
    try {
      this.recentWorkspaces = await this.gateway.getRecentWorkspaces()
      if (this.disposed) return
      this.emit()
    } catch {
      // 忽略无法获取最近工作区的异常
    }
  }

  async restoreCurrent() {
    if (!this.beginMutation()) return
    try {
      const roots = await this.gateway.restoreWorkspaces()
      if (this.disposed || this.rootPath || !roots.length) return
      this.applyWorkspace(roots[0])
      for (const root of roots.slice(1)) this.addWorkspace(root)
    } finally { this.operationBusy = false; this.fileController.workspaceBusy = false }
  }

  restoreSession(roots: WorkspaceInfo[]) {
    if (this.disposed || this.rootPath || !roots.length) return
    this.applyWorkspace(roots[0])
    for (const root of roots.slice(1)) this.addWorkspace(root)
  }

  async openWorkspaceDialog(add = false): Promise<boolean> {
    if (this.operationBusy || this.fileController.saving.size || this.documentManager.isComposing) {
      this.notify('请等待文件操作和输入完成，再切换工作区。'); return false
    }
    if (!add && this.documentManager.hasDirtyDocuments) {
      this.notify('当前有未保存的文档修改，请先保存或关闭未保存标签后再切换工作区。')
      return false
    }
    if (!this.beginMutation()) return false
    try {
      const info = await this.gateway.openWorkspaceDialog(add)
      if (!info) return false
      if (add && this.rootPath) this.addWorkspace(info)
      else this.applyWorkspace(info)
      return true
    } catch (e) {
      this.notify(String(e))
      return false
    } finally { this.operationBusy = false; this.fileController.workspaceBusy = false }
  }

  private addWorkspace(info: WorkspaceInfo) {
    this.cancelExpand()
    this.openRevision++
    if (!this.roots.some(root => root.rootPath === info.rootPath)) this.roots.push(info)
    if (info.warning) this.notify(info.warning)
    this.cancelSearch(); this.searchResults = []; this.searchTotal = 0; this.searchQuery = ''
    this.quickGeneration++; this.quickFiles = []; void this.loadRecents(); this.emit()
  }

  async removeFolder(path: string) {
    this.cancelExpand();this.revealSequence++
    if (this.operationBusy || this.fileController.saving.size || this.documentManager.isComposing) { this.notify('请等待文件操作和输入完成。'); return }
    if (!this.beginMutation()) return
    this.cancelSearch(); this.quickGeneration++
    try {
      await this.gateway.removeWorkspaceFolder(path)
      this.roots = this.roots.filter(root => root.rootPath !== path)
      const first = this.roots[0]
      this.rootPath = first?.rootPath || null; this.rootName = first?.name || ''; this.entries = first?.entries || []
      this.cancelSearch(); this.searchResults = []; this.searchTotal = 0; this.searchQuery = ''
      this.quickGeneration++; this.quickFiles = []; this.emit()
    } catch (error) { this.notify(`移除工作区文件夹失败：${error}`) }
    finally { this.operationBusy = false; this.fileController.workspaceBusy = false }
  }

  async openWorkspacePath(path: string, add = false): Promise<boolean> {
    return this.loadWorkspace(() => this.gateway.openWorkspacePath(path, add), add)
  }

  async openDroppedWorkspace(token: string): Promise<boolean> {
    return this.loadWorkspace(() => this.gateway.openDroppedWorkspace(token), true)
  }

  private async loadWorkspace(load: () => Promise<WorkspaceInfo>, add: boolean): Promise<boolean> {
    if (this.operationBusy || this.fileController.saving.size || this.documentManager.isComposing) {
      this.notify('请等待文件操作和输入完成，再切换工作区。'); return false
    }
    if (!add && this.documentManager.hasDirtyDocuments) {
      this.notify('当前有未保存的文档修改，请先保存或关闭未保存标签后再切换工作区。')
      return false
    }
    if (!this.beginMutation()) return false
    try {
      const info = await load()
      if (add && this.rootPath) this.addWorkspace(info)
      else this.applyWorkspace(info)
      return true
    } catch (e) {
      this.notify(String(e))
      return false
    } finally { this.operationBusy = false; this.fileController.workspaceBusy = false }
  }

  private applyWorkspace(info: WorkspaceInfo) {
    this.cancelExpand();this.revealSequence++
    this.openRevision++
    this.cancelSearch()
    this.quickGeneration++
    this.quickFiles = []
    this.rootPath = info.rootPath
    this.rootName = info.name
    this.entries = info.entries
    this.roots = [info]
    if (info.warning) this.notify(info.warning)
    this.searchResults = []
    this.searchTotal = 0
    this.searchQuery = ''
    void this.loadRecents()
    this.emit()
  }

  private loadFolder(node: WorkspaceNode): Promise<boolean> {
    if (node.children && (node.children.length || !node.hasChildren) && !node.isLoading) return Promise.resolve(true)
    const pending=this.folderLoads.get(node)
    if(pending)return pending
    const root=this.roots.find(root=>root.rootPath===this.rootForPath(node.path))
    if(!root || node.isSymlink)return Promise.resolve(false)
    node.isLoading=true;this.emit()
    const load=(async()=>{
      try {
        const children=await this.gateway.readDirectory(node.path)
        if(this.disposed||!this.roots.includes(root))return false
        const prefix=displayPathKey(node.path)+'/'
        node.children=children.filter(child=>!child.isSymlink&&displayPathKey(child.path).startsWith(prefix))
        node.hasChildren=!!node.children.length;return true
      }catch(error){this.notify(`读取目录失败：${String(error)}`);return false}
      finally {node.isLoading=false;this.folderLoads.delete(node);this.emit()}
    })()
    this.folderLoads.set(node,load);return load
  }
  async toggleFolder(node: WorkspaceNode) {
    if(!node.isDirectory || node.isSymlink)return
    this.cancelExpand()
    node.isExpanded=!node.isExpanded;this.emit()
    if(node.isExpanded && !await this.loadFolder(node))node.isExpanded=false
    this.emit()
  }
  cancelExpand() {this.expandSequence++;this.expanding=false;this.emit()}
  collapseAll() {
    this.cancelExpand();this.revealSequence++
    const stack=this.roots.flatMap(root=>root.entries)
    while(stack.length){const node=stack.pop()!;node.isExpanded=false;if(node.children)for(const child of node.children)stack.push(child)}
    this.emit()
  }
  async expandAll(options: {maxNodes?:number;maxDirectories?:number;maxDepth?:number;timeoutMs?:number} = {}) {
    const sequence=++this.expandSequence,roots=[...this.roots],started=Date.now()
    const maxNodes=Math.min(20000,Math.max(1,options.maxNodes??20000)),maxDirectories=Math.min(250,Math.max(1,options.maxDirectories??250)),maxDepth=Math.min(32,Math.max(1,options.maxDepth??32)),timeout=Math.min(5000,Math.max(1,options.timeoutMs??5000))
    const queue=roots.map(root=>({nodes:root.entries,depth:1}))
    let count=0,directories=0,limited=false
    this.expanding=true;this.emit()
    try {
      outer:for(let cursor=0;cursor<queue.length;cursor++){
        const {nodes,depth}=queue[cursor]
        for(const node of nodes){
          if(this.disposed||sequence!==this.expandSequence||roots.some(root=>!this.roots.includes(root)))break outer
          if(++count>maxNodes||Date.now()-started>timeout){limited=true;break outer}
          if(!node.isDirectory||node.isSymlink)continue
          if(depth>maxDepth){limited=true;continue}
          if(++directories>maxDirectories){limited=true;break outer}
          if(!await this.loadFolder(node))continue
          if(sequence!==this.expandSequence||this.disposed)break outer
          node.isExpanded=true
          if(node.children?.length)queue.push({nodes:node.children,depth:depth+1})
          if(directories%8===0){this.emit();await new Promise<void>(resolve=>setTimeout(resolve,0))}
        }
      }
      if(limited&&sequence===this.expandSequence)this.notify('全部展开已达到保护预算，可手动展开剩余目录。')
      return {count,directories,limited,canceled:sequence!==this.expandSequence}
    }finally{if(sequence===this.expandSequence)this.expanding=false;this.emit()}
  }
  private preserveFolders(previous:WorkspaceNode[],fresh:WorkspaceNode[]) {
    const known=new Map(previous.map(node=>[displayPathKey(node.path),node]))
    return fresh.map(node=>{const old=known.get(displayPathKey(node.path));return old?.isDirectory&&node.isDirectory?Object.assign(old,node):node})
  }
  async revealFileInTree(path: string, refreshTarget=false) {
    this.cancelExpand()
    const sequence = ++this.revealSequence
    const root = this.roots.find(root => root.rootPath === this.rootForPath(path))
    if (!root) return false
    const normalized = displayPathKey
    const target = normalized(path)
    let nodes = root.entries, parent:WorkspaceNode|undefined
    for (let depth = 0; depth < 256 && !this.disposed && sequence === this.revealSequence; depth++) {
      if(refreshTarget){
        try {
          const fresh=await this.gateway.readDirectory(parent?.path||root.rootPath)
          if(sequence!==this.revealSequence||this.disposed||!this.roots.includes(root))return false
          nodes=this.preserveFolders(nodes,fresh)
          if(parent)parent.children=nodes
          else {root.entries=nodes;if(this.roots[0]===root)this.entries=nodes}
        }catch(error){this.notify(`定位文件失败：${String(error)}`);return false}
      }
      if (nodes.some(node => !node.isDirectory && normalized(node.path) === target)) {this.emit();return true}
      parent = nodes.find(node => node.isDirectory && !node.isSymlink && target.startsWith(normalized(node.path) + '/'))
      if (!parent || !await this.loadFolder(parent)) return false
      if (sequence !== this.revealSequence || !this.roots.includes(root)) return false
      parent.isExpanded=true;this.emit()
      nodes = parent.children || []
    }
    return false
  }
  async revealNode(path:string) {
    if(!this.gateway.revealNode) { this.notify('当前环境不支持系统文件管理器。'); return }
    try {await this.gateway.revealNode(path)}catch(error){this.notify(`在文件管理器中显示失败：${String(error)}`)}
  }

  async refreshDirectory(node?: WorkspaceNode) {
    this.cancelExpand();this.revealSequence++
    if (!this.rootPath) return
    try {
      if (!node) {
        for (const root of this.roots) root.entries = await this.gateway.readDirectory(root.rootPath)
        this.entries = this.roots[0]?.entries || []
      } else if (node.isDirectory) {
        node.isLoading = true
        this.emit()
        node.children = await this.gateway.readDirectory(node.path)
        node.isLoading = false
      }
      this.emit()
    } catch (e) {
      this.notify(String(e))
    } finally {
      if (node) node.isLoading = false
      this.emit()
    }
  }

  async openFile(node: WorkspaceNode, preview = true) {
    if (node.isDirectory || this.documentManager.isComposing) return

    const targetPane = this.documentManager.activePaneId
    const targetPath = node.path

    // 1. 若目标文件已打开：直接激活聚焦；若为双击(preview=false)则固定
    const existingDoc = this.documentManager.openedDocuments.find(
      doc => doc.path && sameFilePath(doc.path, targetPath)
    )
    if (existingDoc) {
      if (!preview) {
        this.documentManager.pin(existingDoc.id)
      }
      this.documentManager.select(existingDoc.id, targetPane)
      return
    }

    // 2. 若同一文件已有正在进行中的异步请求（如快速双击事件）：合并固定标记
    const inFlight = this.inFlightOpens.get(targetPath)
    if (inFlight) {
      if (!preview) {
        inFlight.preview = false
      }
      return inFlight.promise
    }

    const seq = ++this.openFileSeq
    this.latestPaneSeq.set(targetPane, seq)

    const requestInfo = { seq, preview, promise: Promise.resolve() }

    const promise = (async () => {
      try {
        const openFile = await this.gateway.openWorkspaceFile(targetPath)

        // 3. 过期检查：如果在等待读取期间同 Pane 发起了更新的打开请求（如 A->B->C）
        const latestSeq = this.latestPaneSeq.get(targetPane) || 0
        if (seq < latestSeq) {
          // 当前响应已过期，释放其文件 token，避免泄漏
          const alreadyOpen = this.documentManager.openedDocuments.some(
            doc => doc.fileToken === openFile.token
          )
          if (!alreadyOpen) {
            void this.fileController.gateway.release(openFile.token).catch(() => {})
          }
          return
        }

        // 4. 正常接收并展示（使用最终的 preview 标记）
        this.fileController.accept(openFile, requestInfo.preview)
      } catch (e) {
        this.notify(`打开工作区文件失败: ${e}`)
      } finally {
        this.inFlightOpens.delete(targetPath)
      }
    })()

    requestInfo.promise = promise
    this.inFlightOpens.set(targetPath, requestInfo)
    return promise
  }

  async createFile(parentDir: string, name: string) {
    if (!this.beginMutation()) return
    try {
      const newNode = await this.gateway.createFile(parentDir, name)
      await this.insertNode(parentDir, newNode)
      await this.openFile(newNode)
      this.notify(`已创建文件: ${name}`)
    } catch (e) {
      this.notify(`创建文件失败: ${e}`)
    } finally { this.operationBusy = false; this.fileController.workspaceBusy = false }
  }

  async createDirectory(parentDir: string, name: string) {
    if (!this.beginMutation()) return
    try {
      const newNode = await this.gateway.createDirectory(parentDir, name)
      await this.insertNode(parentDir, newNode)
      this.notify(`已创建文件夹: ${name}`)
    } catch (e) {
      this.notify(`创建文件夹失败: ${e}`)
    } finally { this.operationBusy = false; this.fileController.workspaceBusy = false }
  }

  private async insertNode(parentDir: string, node: WorkspaceNode) {
    const root = this.roots.find(item => item.rootPath === parentDir)
    if (root) {
      root.entries.push(node)
      this.sortNodes(root.entries)
    } else {
      const parent = this.roots.map(root => this.findNodeByPath(root.entries, parentDir)).find(Boolean)
      if (parent && parent.isDirectory) {
        parent.children = await this.gateway.readDirectory(parent.path)
        parent.isExpanded = true
      }
    }
    this.emit()
  }

  async renameNode(node: WorkspaceNode, newName: string) {
    if (!newName.trim() || newName === node.name) return
    if (!this.beginMutation()) return
    const oldPath = node.path
    try {
      const [oldRel, newRel] = await this.gateway.renameNode(oldPath, newName)
      this.relocate(oldRel, newRel, this.rootForPath(oldPath) || this.rootPath!)
      this.notify(`已重命名: ${oldRel} → ${newRel}`)
      this.emit()
    } catch (e) {
      this.notify(`重命名失败: ${e}`)
    } finally { this.operationBusy = false; this.fileController.workspaceBusy = false }
  }

  private beginMutation() {
    if (this.operationBusy || this.fileController.saving.size || this.documentManager.isComposing) {
      this.notify('请等待文件操作和输入完成。'); return false
    }
    this.operationBusy = true
    this.fileController.workspaceBusy = true
    return true
  }

  rootForPath(path: string) {
    const normalized = displayPathKey(path)
    return [...this.roots].sort((a,b)=>b.rootPath.length-a.rootPath.length).find(root => {
      const base = displayPathKey(root.rootPath).replace(/\/$/,'')
      return normalized === base || normalized.startsWith(base + '/')
    })?.rootPath || null
  }

  private absolute(relative: string, root: string) {
    const separator = root.includes('\\') ? '\\' : '/'
    return `${root}${separator}${relative.replace(/\//g, separator)}`
  }

  private relocate(oldRelative: string, newRelative: string, root: string) {
    const old = this.absolute(oldRelative, root), next = this.absolute(newRelative, root)
    for (const doc of this.documentManager.openedDocuments) {
      const normalized = doc.path.replace(/\\/g, '/')
      const source = old.replace(/\\/g, '/')
      if (normalized === source || normalized.startsWith(source + '/')) {
        const moved = next + doc.path.slice(old.length)
        this.documentManager.renamePath(doc.path, moved, moved.split(/[\\/]/).pop()!)
      }
    }
    const visit = (nodes: WorkspaceNode[]) => {
      for (const item of nodes) {
        if (item.relativePath === oldRelative || item.relativePath.startsWith(oldRelative + '/')) {
          item.relativePath = newRelative + item.relativePath.slice(oldRelative.length)
          item.path = this.absolute(item.relativePath, root)
          item.id = item.relativePath
          item.name = item.relativePath.split('/').pop()!
        }
        if (item.children) visit(item.children)
      }
      this.sortNodes(nodes)
    }
    visit(this.roots.find(item => item.rootPath === root)?.entries || this.entries)
    this.cancelSearch()
    this.searchResults = []; this.searchTotal = 0; this.searchQuery = ''
    this.quickGeneration++; this.quickFiles = []
  }

  async moveNode(node: WorkspaceNode, destination: string) {
    if (!this.beginMutation()) return
    try {
      const [oldRelative, newRelative] = await this.gateway.moveNode(node.path, destination)
      this.relocate(oldRelative, newRelative, this.rootForPath(node.path) || this.rootPath!)
      await this.refreshDirectory()
      this.notify(`已移动: ${oldRelative} → ${newRelative}`)
    } catch (e) { this.notify(`移动失败: ${e}`) }
    finally { this.operationBusy = false; this.fileController.workspaceBusy = false }
  }

  async deleteNode(node: WorkspaceNode) {
    const path = node.path.replace(/\\/g, '/')
    if (this.documentManager.openedDocuments.some(doc => doc.path.replace(/\\/g, '/') === path || doc.path.replace(/\\/g, '/').startsWith(path + '/'))) {
      this.notify('请先保存并关闭此条目内的已打开文件，再删除。'); return
    }
    if (!this.beginMutation()) return
    try {
      const rel = await this.gateway.deleteNode(node.path)
      for (const root of this.roots) this.removeNodeFromTree(root.entries, node.path)
      this.cancelSearch()
      this.searchResults = []; this.searchTotal = 0; this.searchQuery = ''
      this.quickGeneration++; this.quickFiles = []
      this.notify(`已删除: ${rel}`)
      this.emit()
    } catch (e) {
      this.notify(`删除失败: ${e}`)
    } finally { this.operationBusy = false; this.fileController.workspaceBusy = false }
  }

  private removeNodeFromTree(list: WorkspaceNode[], path: string): boolean {
    const idx = list.findIndex(n => n.path === path)
    if (idx !== -1) {
      list.splice(idx, 1)
      return true
    }
    for (const item of list) {
      if (item.children && this.removeNodeFromTree(item.children, path)) {
        return true
      }
    }
    return false
  }

  private findNodeByPath(list: WorkspaceNode[], path: string): WorkspaceNode | null {
    for (const item of list) {
      if (item.path === path) return item
      if (item.children) {
        const found = this.findNodeByPath(item.children, path)
        if (found) return found
      }
    }
    return null
  }

  private sortNodes(nodes: WorkspaceNode[]) {
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
  }

  // --- 全文搜索管理 ---

  async search(queryText: string) {
    const q = queryText.trim()
    if (!q) {
      this.cancelSearch()
      this.searchResults = []
      this.searchTotal = 0
      this.searchQuery = ''
      this.searching = false
      this.emit()
      return
    }

    if (!this.rootPath) {
      this.notify('请先打开工作区，再执行工作区搜索。')
      return
    }

    // 取消旧搜索
    this.cancelSearch()

    this.searchId = `search-${Date.now()}-${++this.searchSequence}`
    const searchId = this.searchId
    this.searchQuery = q
    this.searching = true
    this.searchResults = []
    this.searchTotal = 0
    this.emit()

    const query: SearchQuery = {
      search_id: this.searchId,
      query: q,
      is_case_sensitive: this.isCaseSensitive,
      is_whole_word: this.isWholeWord,
      is_regex: this.isRegex,
      max_results: 1000,
      include_ignored: this.showIgnored,
    }

    try {
      await this.gateway.searchWorkspace(query)
    } catch (e) {
      if (this.searchId !== searchId || this.disposed) return
      this.searching = false
      this.notify(`搜索失败: ${e}`)
      this.emit()
    }
  }

  cancelSearch() {
    if (this.searchId) {
      const id = this.searchId
      this.searchId = ''
      void this.gateway.cancelSearch(id).catch(() => {})
      this.searching = false
      this.emit()
    }
  }

  private onSearchBatch(batch: SearchMatch[]) {
    if (!batch.length) return
    if (this.disposed || !this.searching || batch[0].search_id !== this.searchId) return

    this.searchTotal += batch.length
    for (const item of batch) {
      let group = this.searchResults.find(g => g.path === item.path)
      if (!group) {
        group = {
          path: item.path,
          relativePath: item.relative_path,
          matches: [],
          isExpanded: true,
        }
        this.searchResults.push(group)
      }
      group.matches.push(item)
    }
    this.emit()
  }

  private onSearchDone(payload: SearchDonePayload) {
    if (payload.search_id === this.searchId) {
      this.searching = false
      this.emit()
    }
  }

  async locateMatch(match: SearchMatch) {
    try {
      const openFile = await this.gateway.openWorkspaceFile(match.path)
      this.fileController.accept(openFile)
      const doc = this.documentManager.openedDocuments.find(d => d.path === match.path)
      if (doc && !this.documentManager.isComposing) {
        this.documentManager.revealPosition(doc.id, match.line_number, match.column_number)
      }
    } catch (e) {
      this.notify(`定位匹配位置失败: ${e}`)
    }
  }

  // 获取工作区所有已知的文件列表（供 Quick Open 快速打开）
  getAllKnownFiles(): { name: string; path: string; relativePath: string }[] {
    const files: { name: string; path: string; relativePath: string }[] = []
    const traverse = (nodes: WorkspaceNode[], prefix: string) => {
      for (const node of nodes) {
        if (!node.isDirectory) {
          files.push({
            name: node.name,
            path: node.path,
            relativePath: prefix + node.relativePath,
          })
        } else if (node.children) {
          traverse(node.children, prefix)
        }
      }
    }
    for (const root of this.roots) traverse(root.entries, this.roots.length > 1 ? `${root.name}/` : '')
    return [...new Map([...files, ...this.quickFiles].map(file => [file.path, file])).values()]
  }

  async quickOpen(query: string) {
    if (!this.rootPath || this.disposed) return
    const generation = ++this.quickGeneration
    try {
      const files = await this.gateway.findFiles(query, this.showIgnored)
      if (generation !== this.quickGeneration || this.disposed) return
      this.quickFiles = files; this.emit()
    } catch (error) { if (generation === this.quickGeneration) this.notify(String(error)) }
  }

  async toggleIgnored() {
    if (!this.rootPath) return
    try {
      const next = !this.showIgnored
      this.entries = await this.gateway.setShowIgnored(next)
      this.showIgnored = next
      await this.refreshDirectory()
      this.quickGeneration++; this.quickFiles = []; this.cancelSearch(); this.emit()
    } catch (error) { this.notify(String(error)) }
  }

  destroy() {
    this.cancelExpand();this.revealSequence++
    this.disposed = true
    this.quickGeneration++
    this.cancelSearch()
    if (this.searchBatchUnsub) this.searchBatchUnsub()
    if (this.searchDoneUnsub) this.searchDoneUnsub()
    this.listeners.clear()
  }
}
