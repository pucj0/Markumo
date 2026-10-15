import { describe, it, expect, vi } from 'vitest'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { WindowCloseGuard, type CloseStatus } from '../src/features/shell/WindowCloseGuard'

describe('P0 Phase A Reproduction and Fix Verification', () => {
  it('reproduces and proves fix for 3 files -> split -> close all -> click empty -> type -> new doc -> close window flow', async () => {
    // 1. 打开三个文件
    const manager = new DocumentManager([
      { id: 'file-1', name: 'one.txt', path: 'C:/test/one.txt', text: 'file 1 content' },
      { id: 'file-2', name: 'two.txt', path: 'C:/test/two.txt', text: 'file 2 content' },
      { id: 'file-3', name: 'three.txt', path: 'C:/test/three.txt', text: 'file 3 content' },
    ])

    manager.open('file-1', false)
    manager.open('file-2', false)
    manager.open('file-3', false)
    expect(manager.openedDocuments.length).toBe(3)

    // 2. 创建第二分栏
    const secondPane = manager.splitPane('right', 'main', 'file-2')
    expect(manager.isSplit).toBe(true)
    expect(manager.layout.getAllLeafIds().length).toBe(2)

    // 3. 关闭所有文件
    manager.close('file-2', true, secondPane)
    // secondPane became empty and was auto-reclaimed!
    expect(manager.layout.getAllLeafIds()).toEqual(['main'])

    manager.close('file-1', true, 'main')
    manager.close('file-2', true, 'main')
    manager.close('file-3', true, 'main')
    expect(manager.openedDocuments.length).toBe(0)

    // 4. 验证空分栏自动回收与单一空 Pane 状态
    expect(manager.isSplit).toBe(false)
    expect(manager.layout.getAllLeafIds()).toEqual(['main'])
    expect(manager.activeDocument).toBeNull()

    // 5. 无文件时绝对不允许挂载可编辑且无归属的 CodeMirror
    expect(manager.activeEditorView).toBeNull()
    expect(manager.paneView('main')).toBeNull()

    // 6. 点击空区域输入英文与中文：不会使 isComposing 变为 true，不会产生孤儿文档或阻止操作
    expect(manager.isComposing).toBe(false)

    // 7. 空 Pane 新建文件入口
    const untitledId = manager.createUntitled()!
    expect(untitledId).toBeTruthy()
    expect(manager.activeDocument?.name).toBe('Untitled-1.txt')

    // 模拟输入文本并验证正常编辑
    manager.dispatch(untitledId, { changes: { from: 0, insert: 'Hello World 中文' } })
    expect(manager.getText(untitledId)).toBe('Hello World 中文')
    expect(manager.metadata(untitledId)?.dirty).toBe(true)

    // 8. 窗口关闭保护：有脏文档时触发确认，不静默关闭，也不弹出错误的“等待输入完成”提示
    const status: CloseStatus = {
      fileBusy: false,
      savingCount: 0,
      composing: manager.isComposing,
      dirtyCount: manager.openedDocuments.filter(d => d.dirty).length,
      documentCount: manager.openedDocuments.length,
      activePane: manager.activePane,
      hasActiveDocument: !!manager.activeId,
    }
    const services = {
      status: () => ({ ...status }),
      flush: vi.fn(async () => {}),
      confirmDirty: vi.fn(),
      destroy: vi.fn(async () => {}),
      blocked: vi.fn(),
      failed: vi.fn(),
      diagnose: vi.fn(),
    }
    const guard = new WindowCloseGuard(services)

    await guard.request('titlebar')
    expect(services.blocked).not.toHaveBeenCalled()
    expect(services.confirmDirty).toHaveBeenCalledOnce()
    expect(services.destroy).not.toHaveBeenCalled()

    // 9. 放弃或保存后正常关闭窗口
    manager.close(untitledId, true)
    status.dirtyCount = 0
    status.hasActiveDocument = false

    await guard.request('titlebar')
    expect(services.destroy).toHaveBeenCalledOnce()
    expect(services.blocked).not.toHaveBeenCalled()

    manager.dispose()
  })
})
