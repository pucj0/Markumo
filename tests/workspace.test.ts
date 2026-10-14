import { describe, it, expect, vi } from 'vitest'
import { undo, undoDepth } from '@codemirror/commands'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { FileController } from '../src/features/files/FileController'
import { WorkspaceController } from '../src/features/workspace/WorkspaceController'
import type {
  SearchDonePayload,
  SearchMatch,
  SearchQuery,
  WorkspaceGateway,
  WorkspaceInfo,
  WorkspaceNode,
} from '../src/features/workspace/contracts'
import type { FileGateway, OpenBatch, OpenFile } from '../src/features/files/contracts'

function createMockFileGateway(): FileGateway {
  return {
    openDialog: vi.fn(),
    openRecent: vi.fn(),
    drainPending: vi.fn(async (): Promise<OpenBatch> => ({ files: [], errors: [] })),
    reopen: vi.fn(),
    saveTarget: vi.fn(),
    save: vi.fn(),
    release: vi.fn(async () => {}),
    preferences: vi.fn(async () => ({
      recent: [],
      layout: { mode: 'workspace' as const, sidebarVisible: true, sidebarWidth: 254 },
    })),
    persistLayout: vi.fn(),
  }
}

function createMockWorkspaceGateway(): WorkspaceGateway {
  let batchCallback: ((batch: SearchMatch[]) => void) | null = null
  let doneCallback: ((payload: SearchDonePayload) => void) | null = null

  return {
    openWorkspaceDialog: vi.fn(async (): Promise<WorkspaceInfo> => ({
      rootPath: 'C:/mock/project',
      name: 'project',
      entries: [
        {
          id: 'src',
          name: 'src',
          path: 'C:/mock/project/src',
          relativePath: 'src',
          isDirectory: true,
          isSymlink: false,
          isReadOnly: false,
          size: 0,
          mtime: 1000,
          hasChildren: true,
          children: [],
        },
        {
          id: 'readme.md',
          name: 'README.md',
          path: 'C:/mock/project/README.md',
          relativePath: 'README.md',
          isDirectory: false,
          isSymlink: false,
          isReadOnly: false,
          size: 100,
          mtime: 1000,
          hasChildren: false,
        },
      ],
    })),
    removeWorkspaceFolder: vi.fn(async () => {}),
    restoreWorkspaces: vi.fn(async () => []),
    openWorkspacePath: vi.fn(async (path: string): Promise<WorkspaceInfo> => ({
      rootPath: path,
      name: 'project',
      entries: [],
    })),
    openWorkspaceFile: vi.fn(async (path: string): Promise<OpenFile> => ({
      token: `token-${path}`,
      path,
      name: path.split('/').pop() || 'file',
      text: Array.from({ length: 20 }, (_, i) => `line ${i + 1}: ${i === 9 ? 'let count = match_target;' : 'sample code'}`).join('\n'),
      encoding: 'UTF-8',
      bom: false,
      eol: 'LF',
      readOnly: false,
      version: 'v1',
    })),
    readDirectory: vi.fn(async (path: string): Promise<WorkspaceNode[]> => [
      {
        id: `${path}/child.rs`,
        name: 'child.rs',
        path: `${path}/child.rs`,
        relativePath: 'src/child.rs',
        isDirectory: false,
        isSymlink: false,
        isReadOnly: false,
        size: 50,
        mtime: 2000,
        hasChildren: false,
      },
    ]),
    createFile: vi.fn(async (parentDir: string, name: string): Promise<WorkspaceNode> => ({
      id: `${parentDir}/${name}`,
      name,
      path: `${parentDir}/${name}`,
      relativePath: name,
      isDirectory: false,
      isSymlink: false,
      isReadOnly: false,
      size: 0,
      mtime: 3000,
      hasChildren: false,
    })),
    createDirectory: vi.fn(async (parentDir: string, name: string): Promise<WorkspaceNode> => ({
      id: `${parentDir}/${name}`,
      name,
      path: `${parentDir}/${name}`,
      relativePath: name,
      isDirectory: true,
      isSymlink: false,
      isReadOnly: false,
      size: 0,
      mtime: 3000,
      hasChildren: false,
      children: [],
    })),
    renameNode: vi.fn(async (oldPath: string, newName: string): Promise<[string, string]> => [
      oldPath.split('/').pop() || '',
      newName,
    ]),
    deleteNode: vi.fn(async (path: string): Promise<string> => path),
    moveNode: vi.fn(async (srcPath: string, destDir: string): Promise<[string, string]> => [
      srcPath,
      `${destDir}/${srcPath.split('/').pop()}`,
    ]),
    getRecentWorkspaces: vi.fn(async (): Promise<string[]> => ['C:/mock/project', 'C:/mock/prev']),
    findFiles: vi.fn(async () => []),
    setShowIgnored: vi.fn(async () => []),
    searchWorkspace: vi.fn(async (query: SearchQuery): Promise<number> => {
      // 模拟异步批量发射
      if (batchCallback) {
        batchCallback([
          {
            search_id: query.search_id,
            path: 'C:/mock/project/src/child.rs',
            relative_path: 'src/child.rs',
            line_number: 10,
            column_number: 5,
            line_text: 'let count = match_target;',
            match_length: 12,
          },
        ])
      }
      if (doneCallback) {
        doneCallback({ search_id: query.search_id, total: 1, canceled: false })
      }
      return 1
    }),
    cancelSearch: vi.fn(async () => {}),
    onSearchBatch: (listener) => {
      batchCallback = listener
      return () => { batchCallback = null }
    },
    onSearchDone: (listener) => {
      doneCallback = listener
      return () => { doneCallback = null }
    },
  }
}

describe('multi-folder workspace', () => {
  it('adds another authorized root without losing dirty text or history, and removes it without closing documents', async () => {
    const manager = new DocumentManager(), files = new FileController(manager,createMockFileGateway(),()=>{})
    const gateway=createMockWorkspaceGateway(), controller=new WorkspaceController(gateway,manager,files,()=>{},false)
    await controller.openWorkspacePath('C:/first')
    const id=manager.createUntitled()!;manager.dispatch(id,{changes:{from:0,insert:'dirty'}})
    await controller.openWorkspacePath('C:/second',true)
    expect(gateway.openWorkspacePath).toHaveBeenLastCalledWith('C:/second',true)
    expect(controller.roots.map(root=>root.rootPath)).toEqual(['C:/first','C:/second'])
    expect(controller.rootForPath('C:/second/a.txt')).toBe('C:/second')
    expect(controller.rootForPath('C:/second-extra/a.txt')).toBeNull()
    await controller.removeFolder('C:/first')
    expect(controller.rootPath).toBe('C:/second');expect(manager.getText(id)).toBe('dirty')
    manager.command('undo');expect(manager.getText(id)).toBe('');controller.destroy();files.dispose();manager.dispose()
  })
  it('restores multiple roots and keeps the previous workspace when adding a directory fails', async () => {
    const manager=new DocumentManager(),files=new FileController(manager,createMockFileGateway(),()=>{}),gateway=createMockWorkspaceGateway()
    vi.mocked(gateway.restoreWorkspaces).mockResolvedValue([{rootPath:'C:/a',name:'a',entries:[]},{rootPath:'C:/b',name:'b',entries:[]}])
    const c=new WorkspaceController(gateway,manager,files,()=>{},false);await c.restoreCurrent()
    vi.mocked(gateway.openWorkspaceDialog).mockRejectedValue(new Error('permission denied'))
    expect(await c.openWorkspaceDialog(true)).toBe(false);expect(c.roots.map(root=>root.rootPath)).toEqual(['C:/a','C:/b'])
    c.destroy();files.dispose();manager.dispose()
  })
})

describe('WorkspaceController (Phase 4)', () => {
  it('opens workspace and loads root entries on demand', async () => {
    const notify = vi.fn()
    const docManager = new DocumentManager()
    const fileController = new FileController(docManager, createMockFileGateway(), notify)
    const wsGateway = createMockWorkspaceGateway()
    const wsController = new WorkspaceController(wsGateway, docManager, fileController, notify)

    const opened = await wsController.openWorkspaceDialog()
    expect(opened).toBe(true)
    expect(wsController.rootName).toBe('project')
    expect(wsController.entries.length).toBe(2)

    // 测试按需展开目录
    const srcFolder = wsController.entries[0]
    expect(srcFolder.isDirectory).toBe(true)
    expect(srcFolder.isExpanded).toBeFalsy()

    await wsController.toggleFolder(srcFolder)
    expect(srcFolder.isExpanded).toBe(true)
    expect(wsGateway.readDirectory).toHaveBeenCalledWith('C:/mock/project/src')
    expect(srcFolder.children?.length).toBe(1)
    expect(srcFolder.children![0].name).toBe('child.rs')
  })

  it('renaming an opened file updates its tab title and path without losing state', async () => {
    const notify = vi.fn()
    const docManager = new DocumentManager()
    const fileController = new FileController(docManager, createMockFileGateway(), notify)
    const wsGateway = createMockWorkspaceGateway()
    const wsController = new WorkspaceController(wsGateway, docManager, fileController, notify)

    await wsController.openWorkspaceDialog()

    // 打开 readme.md
    const readmeNode = wsController.entries[1]
    await wsController.openFile(readmeNode)

    expect(docManager.openedDocuments.length).toBe(1)
    expect(docManager.openedDocuments[0].name).toBe('README.md')
    expect(docManager.openedDocuments[0].path).toBe('C:/mock/project/README.md')

    // 执行重命名
    await wsController.renameNode(readmeNode, 'CHANGELOG.md')
    expect(readmeNode.name).toBe('CHANGELOG.md')

    // 验证 Tab 标签信息已联动同步更新！
    expect(docManager.openedDocuments[0].name).toBe('CHANGELOG.md')
    expect(docManager.openedDocuments[0].path).toContain('CHANGELOG.md')
  })

  it('blocks workspace switching if dirty documents exist to prevent data loss', async () => {
    const notify = vi.fn()
    const docManager = new DocumentManager()
    const fileController = new FileController(docManager, createMockFileGateway(), notify)
    const wsGateway = createMockWorkspaceGateway()
    const wsController = new WorkspaceController(wsGateway, docManager, fileController, notify)

    // 创建一个草稿并做编辑使其 dirty
    const id = docManager.createUntitled()!
    docManager.dispatch(id, { changes: { from: 0, insert: 'dirty uncommitted text' } })
    expect(docManager.hasDirtyDocuments).toBe(true)

    // 尝试切换工作区
    const opened = await wsController.openWorkspaceDialog()
    expect(opened).toBe(false)
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('未保存的文档修改'))
  })

  it('executes workspace search and aggregates grouped results', async () => {
    const notify = vi.fn()
    const docManager = new DocumentManager()
    const fileController = new FileController(docManager, createMockFileGateway(), notify)
    const wsGateway = createMockWorkspaceGateway()
    const wsController = new WorkspaceController(wsGateway, docManager, fileController, notify)

    await wsController.openWorkspaceDialog()
    await wsController.search('match_target')

    expect(wsController.searchTotal).toBe(1)
    expect(wsController.searchResults.length).toBe(1)
    expect(wsController.searchResults[0].relativePath).toBe('src/child.rs')
    expect(wsController.searchResults[0].matches[0].line_number).toBe(10)

    // 定位匹配跳转
    await wsController.locateMatch(wsController.searchResults[0].matches[0])
    expect(docManager.openedDocuments.length).toBe(1)
    expect(docManager.activeDocument?.line).toBe(10)
  })

  it('cancelling search stops streaming and cleans up active search id', async () => {
    const notify = vi.fn()
    const docManager = new DocumentManager()
    const fileController = new FileController(docManager, createMockFileGateway(), notify)
    const wsGateway = createMockWorkspaceGateway()
    const wsController = new WorkspaceController(wsGateway, docManager, fileController, notify)

    await wsController.openWorkspaceDialog()
    void wsController.search('running_query')
    wsController.cancelSearch()

    expect(wsGateway.cancelSearch).toHaveBeenCalled()
    expect(wsController.searching).toBe(false)
    expect(wsController.searchId).toBe('')
  })

  it('drops late batches after cancellation and workspace switching', async () => {
    const manager = new DocumentManager()
    const gateway = createMockWorkspaceGateway()
    let emitBatch!: (batch: SearchMatch[]) => void
    gateway.onSearchBatch = cb => { emitBatch = cb; return () => {} }
    gateway.searchWorkspace = vi.fn(async () => 0)
    const ws = new WorkspaceController(gateway, manager, new FileController(manager, createMockFileGateway(), vi.fn()), vi.fn())
    await ws.openWorkspaceDialog()
    await ws.search('old')
    const id = ws.searchId
    ws.cancelSearch()
    emitBatch([{ search_id: id, path: '/old', relative_path: 'old', line_number: 1, column_number: 1, line_text: 'old', match_length: 3 }])
    expect(ws.searchTotal).toBe(0)
    await ws.search('switch')
    const switchedId = ws.searchId
    await ws.openWorkspacePath('C:/other')
    emitBatch([{ search_id: switchedId, path: '/old', relative_path: 'old', line_number: 1, column_number: 1, line_text: 'old', match_length: 3 }])
    expect(ws.searchTotal).toBe(0)
  })

  it('renames folder descendants without changing text, selection, dirty or undo history', async () => {
    const manager = new DocumentManager(), gateway = createMockWorkspaceGateway(), notify = vi.fn()
    const ws = new WorkspaceController(gateway, manager, new FileController(manager, createMockFileGateway(), notify), notify)
    await ws.openWorkspaceDialog(); const folder = ws.entries[0]
    await ws.toggleFolder(folder); const node = folder.children![0]
    await ws.openFile(node); const id = manager.activeId!
    manager.dispatch(id, { changes: { from: 0, insert: 'unsaved' }, selection: { anchor: 7 } })
    const snapshot = manager.saveSnapshot(id)!
    const state = manager.getState(id)!
    gateway.renameNode = vi.fn(async (): Promise<[string, string]> => ['src', 'renamed'] as [string, string])
    await ws.renameNode(folder, 'renamed')
    expect(node.path).toBe('C:/mock/project/renamed/child.rs')
    expect(manager.activeDocument?.path).toBe(node.path)
    expect(manager.activeDocument?.dirty).toBe(true)
    expect(manager.saveSnapshot(id)?.text).toBe(snapshot.text)
    expect(manager.getState(id)!.selection.eq(state.selection)).toBe(true)
    expect(undoDepth(manager.getState(id)!)).toBe(undoDepth(state))
    expect(undo({ state: manager.getState(id)!, dispatch: transaction => manager.dispatch(id, transaction) })).toBe(true)
    expect(manager.activeDocument?.dirty).toBe(false)
  })

  it('blocks deletion of open descendants and saving during a rename', async () => {
    const manager = new DocumentManager(), gateway = createMockWorkspaceGateway(), fileGateway = createMockFileGateway(), notify = vi.fn()
    const files = new FileController(manager, fileGateway, notify)
    const ws = new WorkspaceController(gateway, manager, files, notify)
    await ws.openWorkspaceDialog(); const folder = ws.entries[0]
    await ws.toggleFolder(folder); await ws.openFile(folder.children![0])
    await ws.deleteNode(folder)
    expect(gateway.deleteNode).not.toHaveBeenCalled()
    let finish!: (value: [string, string]) => void
    gateway.renameNode = vi.fn((): Promise<[string, string]> => new Promise<[string, string]>(resolve => { finish = resolve }))
    const pending = ws.renameNode(folder, 'renamed')
    expect(await files.save(manager.activeId!)).toBe(false)
    expect(fileGateway.save).not.toHaveBeenCalled()
    finish(['src', 'renamed']); await pending
    expect(files.workspaceBusy).toBe(false)
  })

  it('ignores stale Quick Open responses and resets results on a workspace switch', async () => {
    const manager = new DocumentManager(), gateway = createMockWorkspaceGateway(), notify = vi.fn()
    const ws = new WorkspaceController(gateway, manager, new FileController(manager, createMockFileGateway(), notify), notify)
    await ws.openWorkspaceDialog()
    let finish!: (value: { name: string; path: string; relativePath: string }[]) => void
    gateway.findFiles = vi.fn((): Promise<{ name: string; path: string; relativePath: string }[]> => new Promise<{ name: string; path: string; relativePath: string }[]>(resolve => { finish = resolve }))
    const pending = ws.quickOpen('deep')
    await ws.openWorkspacePath('C:/other')
    finish([{ name: 'deep.txt', path: 'C:/old/deep.txt', relativePath: 'deep.txt' }]); await pending
    expect(ws.quickFiles).toEqual([])
  })

  it('clears folder loading state when refresh fails', async () => {
    const manager = new DocumentManager(), gateway = createMockWorkspaceGateway(), notify = vi.fn()
    const ws = new WorkspaceController(gateway, manager, new FileController(manager, createMockFileGateway(), notify), notify)
    await ws.openWorkspaceDialog()
    gateway.readDirectory = vi.fn(async () => { throw new Error('denied') })
    await ws.refreshDirectory(ws.entries[0])
    expect(ws.entries[0].isLoading).toBe(false)
  })

  it('preview replacement releases the old grant; dirty documents remain pinned', async () => {
    const manager = new DocumentManager(), gateway = createMockWorkspaceGateway(), fileGateway = createMockFileGateway(), notify = vi.fn()
    const ws = new WorkspaceController(gateway, manager, new FileController(manager, fileGateway, notify), notify)
    await ws.openWorkspaceDialog(); await ws.toggleFolder(ws.entries[0])
    await ws.openFile(ws.entries[1])
    const replaced = manager.activeId!
    await ws.openFile(ws.entries[0].children![0])
    expect(manager.metadata(replaced)).toBeNull()
    expect(fileGateway.release).toHaveBeenCalledWith('token-C:/mock/project/README.md')
    const edited = manager.activeId!
    manager.dispatch(edited, { changes: { from: 0, insert: 'dirty' } })
    await ws.openFile(ws.entries[1])
    expect(manager.metadata(edited)?.dirty).toBe(true)
    expect(manager.openedDocuments).toHaveLength(2)
  })

  it('releases a late open grant when IME starts while opening an already open file', async () => {
    const manager = new DocumentManager(), gateway = createMockWorkspaceGateway(), fileGateway = createMockFileGateway(), notify = vi.fn()
    const files = new FileController(manager, fileGateway, notify)
    const file = await gateway.openWorkspaceFile('C:/mock/project/readme.txt')
    expect(files.accept(file)).toBe(true)
    Object.defineProperty(manager, 'isComposing', { configurable: true, get: () => true })
    expect(files.accept({ ...file, token: 'late-open-token' })).toBe(false)
    expect(fileGateway.release).toHaveBeenCalledWith('late-open-token')
    expect(fileGateway.release).not.toHaveBeenCalledWith(file.token)
    expect(manager.openedDocuments).toHaveLength(1)
  })
})
