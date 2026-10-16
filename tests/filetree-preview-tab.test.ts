import { describe, it, expect, vi } from 'vitest'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { TabGroup } from '../src/features/tabs/TabGroup'
import { WorkspaceController } from '../src/features/workspace/WorkspaceController'
import { FileController } from '../src/features/files/FileController'
import type { WorkspaceNode } from '../src/features/workspace/contracts'
import type { OpenFile } from '../src/features/files/contracts'

describe('File Tree Click & Fleet Preview Tab Behavior', () => {
  it('manages preview tab replacement: single click opens preview, subsequent preview replaces unpinned and clean tab', () => {
    const group = new TabGroup('main')

    // 1. 打开 A.txt 作为预览 (preview = true)
    const replaced1 = group.open('doc-a', true)
    expect(replaced1).toBeNull()
    expect(group.tabs.length).toBe(1)
    expect(group.tabs[0].documentId).toBe('doc-a')
    expect(group.tabs[0].pinned).toBe(false)

    // 2. 接着打开 B.txt 作为预览：因为 A 未修改且未固定，B 替换 A
    const replaced2 = group.open('doc-b', true)
    expect(replaced2).toBe('doc-a')
    expect(group.tabs.length).toBe(1)
    expect(group.tabs[0].documentId).toBe('doc-b')
    expect(group.tabs[0].pinned).toBe(false)

    // 3. 将 B 双击固定 (pin)
    group.pin('doc-b')
    expect(group.tabs[0].pinned).toBe(true)

    // 4. B 固定后再打开 C.txt 作为预览：B 不被替换，C 作为新的预览标签追加
    const replaced3 = group.open('doc-c', true)
    expect(replaced3).toBeNull()
    expect(group.tabs.length).toBe(2)
    expect(group.tabs[0].documentId).toBe('doc-b')
    expect(group.tabs[0].pinned).toBe(true)
    expect(group.tabs[1].documentId).toBe('doc-c')
    expect(group.tabs[1].pinned).toBe(false)
  })

  it('prevents replacing a dirty preview document', () => {
    const group = new TabGroup('main')
    group.open('doc-a', true)

    // 模拟 doc-a 已经被修改 (dirty)
    const canReplace = (id: string) => id !== 'doc-a'

    // 打开 doc-b 时，因为 doc-a dirty 不可替换，doc-b 不替换 doc-a 而是追加
    const replaced = group.open('doc-b', true, canReplace)
    expect(replaced).toBeNull()
    expect(group.tabs.length).toBe(2)
    expect(group.tabs[0].documentId).toBe('doc-a')
    expect(group.tabs[1].documentId).toBe('doc-b')
  })

  it('preserves permanent tabs when re-clicked with preview=true (never demotes permanent tab to preview)', () => {
    const group = new TabGroup('main')
    group.open('doc-a', false) // 永久打开
    expect(group.tabs[0].pinned).toBe(true)

    // 再次单击 A 试图作为 preview 打开：不降低为预览
    group.open('doc-a', true)
    expect(group.tabs[0].pinned).toBe(true)
  })

  it('double clicking permanent tab keeps it permanent and never toggles to preview', () => {
    const group = new TabGroup('main')
    group.open('doc-a', false)
    expect(group.tabs[0].pinned).toBe(true)

    // 再次调用 pin 或打开不会取消固定
    group.pin('doc-a')
    expect(group.tabs[0].pinned).toBe(true)
  })

  it('automatically pins document upon content modification without saving to disk', () => {
    const manager = new DocumentManager([
      { id: 'doc-a', name: 'a.txt', path: '/workspace/a.txt', text: 'Hello' }
    ])
    // 以 preview 打开
    manager.open('doc-a', true)
    const primaryPane = manager.layout.getPrimaryPane()
    expect(primaryPane.group.tabs[0].pinned).toBe(false)

    // 用户在编辑器中修改内容
    manager.dispatch('doc-a', {
      changes: { from: 5, insert: ' World' }
    })

    // 验证：文档已自动固定为 Permanent Tab
    expect(primaryPane.group.tabs[0].pinned).toBe(true)
    // 验证：产生了未保存修改 (dirty)，但没有自动保存
    expect(manager.activeDocument?.dirty).toBe(true)
  })

  it('does NOT pin on pure browsing operations: cursor move, selection, or scroll', () => {
    const manager = new DocumentManager([
      { id: 'doc-a', name: 'a.txt', path: '/workspace/a.txt', text: 'Hello World' }
    ])
    manager.open('doc-a', true)
    const primaryPane = manager.layout.getPrimaryPane()
    expect(primaryPane.group.tabs[0].pinned).toBe(false)

    // 单纯移动选区/光标
    manager.dispatch('doc-a', {
      selection: { anchor: 2, head: 5 }
    })

    // 依然保持为 preview 标签
    expect(primaryPane.group.tabs[0].pinned).toBe(false)
    expect(manager.activeDocument?.dirty).toBe(false)
  })

  it('manages preview tabs independently across multiple panes', () => {
    const manager = new DocumentManager([
      { id: 'doc-a', name: 'a.txt', path: '/a.txt', text: 'A' },
      { id: 'doc-b', name: 'b.txt', path: '/b.txt', text: 'B' },
      { id: 'doc-c', name: 'c.txt', path: '/c.txt', text: 'C' },
    ])

    // 在主 Pane 打开 A (preview)
    manager.open('doc-a', true, 'main')
    // 向右分栏
    manager.splitPane('right')
    const leaves = manager.layout.getAllLeafIds()
    const leftPane = leaves[0]
    const rightPane = leaves[1]

    // 在右侧 Pane 打开 B (preview)
    manager.open('doc-b', true, rightPane)

    // 在左侧 Pane 打开 C (preview)：只替换左侧的 A，不影响右侧的 B
    manager.open('doc-c', true, leftPane)

    const leftTabs = manager.layout.getPane(leftPane)!.group.tabs
    const rightTabs = manager.layout.getPane(rightPane)!.group.tabs

    expect(leftTabs.map(t => t.documentId)).toEqual(['doc-c'])
    expect(rightTabs.map(t => t.documentId)).toContain('doc-b')
  })

  it('handles out-of-order async responses: discard stale responses and keep the latest clicked file', async () => {
    const manager = new DocumentManager([])
    const mockGateway = {
      openWorkspaceFile: vi.fn(),
      release: vi.fn().mockResolvedValue(true),
    }
    const mockFileGateway = {
      release: vi.fn().mockResolvedValue(true),
      openDialog: vi.fn(),
      saveDialog: vi.fn(),
      openRecent: vi.fn(),
      saveInPlace: vi.fn(),
      saveAs: vi.fn(),
    }
    const fileController = new FileController(manager, mockFileGateway as any, () => {})
    const wsController = new WorkspaceController(mockGateway as any, manager, fileController, () => {}, false)

    let resolveA!: (val: OpenFile) => void
    let resolveB!: (val: OpenFile) => void

    mockGateway.openWorkspaceFile.mockImplementation((path: string) => {
      if (path === '/a.txt') {
        return new Promise(res => { resolveA = res })
      }
      if (path === '/b.txt') {
        return new Promise(res => { resolveB = res })
      }
      return Promise.reject('unknown')
    })

    const nodeA: WorkspaceNode = {
      id: '/a.txt',
      name: 'a.txt',
      path: '/a.txt',
      relativePath: 'a.txt',
      isDirectory: false,
      isSymlink: false,
      isReadOnly: false,
      size: 10,
      mtime: null,
      hasChildren: false,
    }
    const nodeB: WorkspaceNode = {
      id: '/b.txt',
      name: 'b.txt',
      path: '/b.txt',
      relativePath: 'b.txt',
      isDirectory: false,
      isSymlink: false,
      isReadOnly: false,
      size: 10,
      mtime: null,
      hasChildren: false,
    }

    // 用户先点击 A，再快速点击 B
    const pA = wsController.openFile(nodeA, true)
    const pB = wsController.openFile(nodeB, true)

    // B 优先返回（网络/磁盘更快）
    resolveB({
      token: 'tok-b',
      path: '/b.txt',
      name: 'b.txt',
      text: 'Content B',
      encoding: 'UTF-8',
      bom: false,
      eol: 'LF',
      readOnly: false,
      version: '1',
    })
    await pB

    // 验证当前打开的是 B
    expect(manager.openedDocuments.map(d => d.name)).toEqual(['b.txt'])

    // A 滞后返回：应该被过期判定丢弃，不覆盖 B，且 token 被释放
    resolveA({
      token: 'tok-a',
      path: '/a.txt',
      name: 'a.txt',
      text: 'Content A',
      encoding: 'UTF-8',
      bom: false,
      eol: 'LF',
      readOnly: false,
      version: '1',
    })
    await pA

    // 验证：依然保持为 B，A 没有覆盖 B！
    expect(manager.openedDocuments.map(d => d.name)).toEqual(['b.txt'])
    // 验证：A 的 token 被释放
    expect(mockFileGateway.release).toHaveBeenCalledWith('tok-a')
  })
})
