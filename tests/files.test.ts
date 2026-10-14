import { describe, expect, it, vi } from 'vitest'
import { undo, redo, isolateHistory, undoDepth } from '@codemirror/commands'
import { EditorSelection, Transaction } from '@codemirror/state'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { FileController } from '../src/features/files/FileController'
import type { FileGateway, FileMetadata, OpenFile } from '../src/features/files/contracts'

const fixture = (extra: Partial<OpenFile> = {}): OpenFile => ({ token: 'file-1', path: 'E:\\fixtures\\中文.txt', name: '中文.txt',
  text: '第一行\r\n第二行', encoding: 'UTF-8', bom: true, eol: 'CRLF', readOnly: false, version: 'disk-1', ...extra })
function setup() {
  const manager = new DocumentManager([], async () => [])
  const gateway: FileGateway = {
    openDialog: vi.fn(async () => ({ files: [fixture()], errors: [] })), openRecent: vi.fn(async () => fixture()),
    drainPending: vi.fn(async () => ({ files: [], errors: [] })), reopen: vi.fn(async () => fixture()),
    saveTarget: vi.fn(async () => ({ token: 'target-1', path: 'E:\\fixtures\\new.txt', version: null })),
    save: vi.fn(async (token, _text, _version, encoding, bom): Promise<FileMetadata> => ({ ...fixture(), token, encoding, bom, version: 'disk-2' })),
    release: vi.fn(async () => {}), preferences: vi.fn(async () => ({ recent: [], layout: { mode: 'single' as const, sidebarWidth: 254, sidebarVisible: false } })),
    persistLayout: vi.fn(async () => {}),
  }
  const notify = vi.fn()
  const files = new FileController(manager, gateway, notify)
  return { manager, gateway, files, notify }
}
function applyHistory(manager: DocumentManager, id: string, action = undo) {
  return action({ state: manager.getState(id)!, dispatch: tr => manager.dispatch(id, tr) })
}
const deferred = <T>() => { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done }), resolve } }

describe('真实 CodeMirror 文件状态（gateway 为显式单元测试替身，不验证磁盘）', () => {
  it('前端 dispose 释放两个窗格的文件授权，重复 dispose 不重复释放', () => {
    const {manager,files,gateway}=setup();files.accept(fixture());manager.splitEditor();manager.focusPane('secondary',false)
    files.accept(fixture({token:'file-2',path:'E:\\fixtures\\second.txt',name:'second.txt'}))
    files.dispose();files.dispose()
    expect(gateway.release).toHaveBeenCalledTimes(2);expect(gateway.release).toHaveBeenCalledWith('file-1');expect(gateway.release).toHaveBeenCalledWith('file-2')
    manager.dispose()
  })
  it('双窗格关闭第一个共享标签不会释放 Rust 文件授权；最后关闭才释放', () => {
    const {manager,files,gateway}=setup();files.accept(fixture());const id=manager.activeId!
    manager.splitEditor();expect(files.close(id,false,'main')).toBe('closed')
    expect(gateway.release).not.toHaveBeenCalled();expect(manager.saveSnapshot(id)).not.toBeNull()
    expect(files.close(id,false,'secondary')).toBe('closed');expect(gateway.release).toHaveBeenCalledWith('file-1')
    manager.dispose()
  })
  it.each(['中文\r\n第二行', '\ufeff源码\n无末尾换行', 'a\rb\rc\r', 'a\r\nb\nc\rd\r\n', '中文🚀'])('完整保留源码换行与末尾状态 %j', source => {
    const { manager } = setup(); const id = manager.openFile(fixture({ text: source }))!
    expect(manager.saveSnapshot(id)!.text).toBe(source)
    expect(manager.metadata(id)).not.toHaveProperty('text')
    expect(manager.metadata(id)).not.toHaveProperty('content')
    manager.dispose()
  })
  it('只有换行风格改变而规范化文本相同，也必须保持 dirty 和关闭保护', () => {
    const { manager } = setup(); const source = 'a\rb\nc\n'
    const id = manager.openFile(fixture({ text: source }))!
    manager.dispatch(id, { changes: { from: 0, to: manager.getState(id)!.doc.length, insert: 'a\nb\nc\n' } })
    expect(manager.getText(id)).toBe('a\nb\nc\n')
    expect(manager.saveSnapshot(id)!.text).toBe('a\nb\nc\n')
    expect(manager.metadata(id)!.dirty).toBe(true)
    expect(manager.close(id)).toBe('dirty')
    applyHistory(manager, id)
    expect(manager.saveSnapshot(id)!.text).toBe(source)
    expect(manager.metadata(id)!.dirty).toBe(false)
    manager.dispose()
  })
  it('连续键入合并的撤销事件也恢复少见的原始换行', () => {
    const { manager } = setup(); const source = 'a\rb\nc\nd\n'
    const id = manager.openFile(fixture({ text: source }))!
    manager.dispatch(id, { changes: { from: 1, to: 2 }, annotations: Transaction.userEvent.of('delete.backward') })
    manager.dispatch(id, { changes: { from: 0, to: 1 }, annotations: Transaction.userEvent.of('delete.backward') })
    expect(undoDepth(manager.getState(id)!)).toBe(1)
    expect(applyHistory(manager, id)).toBe(true)
    expect(manager.saveSnapshot(id)!.text).toBe(source)
    applyHistory(manager, id, redo); expect(manager.saveSnapshot(id)!.text).toBe('b\nc\nd\n')
    manager.dispose()
  })
  it('混合换行映射经插入、删除、多选事务、撤销与重做正确恢复', () => {
    const { manager } = setup(); const source = 'a\r\nb\nc\rd\r\n'
    const id = manager.openFile(fixture({ text: source }))!
    manager.dispatch(id, { changes: [{ from: 0, insert: '头\n' }, { from: 3, to: 4, insert: '' }], annotations: isolateHistory.of('full') })
    const edited = manager.saveSnapshot(id)!.text
    expect(edited).toBe('头\r\na\r\nbc\rd\r\n')
    expect(applyHistory(manager, id)).toBe(true)
    expect(manager.saveSnapshot(id)!.text).toBe(source)
    expect(manager.metadata(id)!.dirty).toBe(false)
    expect(applyHistory(manager, id, redo)).toBe(true)
    expect(manager.saveSnapshot(id)!.text).toBe(edited)
    manager.dispose()
  })
  it('重复打开不覆盖 dirty，不丢选区、历史或创建第二个标签', () => {
    const { manager, files, notify } = setup(); files.accept(fixture()); const id = manager.activeId!
    manager.dispatch(id, { changes: { from: 0, insert: '修改' }, selection: EditorSelection.cursor(2) })
    const state = manager.getState(id)
    files.accept(fixture({ text: '外部内容', version: 'disk-99' }))
    expect(manager.getState(id)).toBe(state)
    expect(manager.openedDocuments).toHaveLength(1)
    expect(manager.metadata(id)!.lastDiskVersion).toBe('disk-1')
    expect(manager.getText(id)).toContain('修改')
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('磁盘版本变化'))
    manager.dispose()
  })
  it('异步保存只清理快照，新输入仍 dirty，禁止重复保存和保存中关闭', async () => {
    const { manager, files, gateway } = setup(); files.accept(fixture()); const id = manager.activeId!
    manager.dispatch(id, { changes: { from: 0, insert: '快照' }, annotations: isolateHistory.of('full') })
    const pending = deferred<FileMetadata>(); gateway.save = vi.fn(() => pending.promise)
    const save = files.save(id)
    expect(await files.save(id)).toBe(false)
    expect(files.close(id, true)).toBe('saving')
    manager.dispatch(id, { changes: { from: 0, insert: '后续' }, annotations: isolateHistory.of('full') })
    pending.resolve({ ...fixture(), version: 'disk-2' })
    expect(await save).toBe(false)
    expect(manager.metadata(id)!.lastDiskVersion).toBe('disk-2')
    expect(manager.metadata(id)!.dirty).toBe(true)
    expect(vi.mocked(gateway.save).mock.calls[0][1]).toBe('快照第一行\r\n第二行')
    applyHistory(manager, id); expect(manager.metadata(id)!.dirty).toBe(false)
    manager.dispose()
  })
  it.each(['conflict', 'permission', 'sharing violation', 'read_only', 'encoding_loss'])('保存失败 %s 保留内容、历史和 disk version', async error => {
    const { manager, files, gateway } = setup(); files.accept(fixture()); const id = manager.activeId!
    manager.dispatch(id, { changes: { from: 0, insert: '不能丢失🚀' } })
    const state = manager.getState(id)
    gateway.save = vi.fn(async () => { throw { code: error, message: error } })
    expect(await files.save(id)).toBe(false)
    expect(manager.getState(id)!.doc).toBe(state!.doc)
    expect(manager.getState(id)!.selection.eq(state!.selection)).toBe(true)
    expect(undoDepth(manager.getState(id)!)).toBe(undoDepth(state!))
    expect(manager.metadata(id)!.lastDiskVersion).toBe('disk-1')
    expect(manager.metadata(id)!.dirty).toBe(true)
    manager.dispose()
  })
  it('新文件取消另存为保留 dirty；成功另存为更新身份与语言，不重置历史', async () => {
    const { manager, files, gateway } = setup(); const id = manager.createUntitled()!
    manager.dispatch(id, { changes: { from: 0, insert: '{"中文":1}' } })
    gateway.saveTarget = vi.fn(async () => null)
    expect(await files.save(id)).toBe(false); expect(manager.metadata(id)!.dirty).toBe(true)
    gateway.saveTarget = vi.fn(async () => ({ token: 'json-file', path: 'E:\\new.json', version: null }))
    gateway.save = vi.fn(async () => ({ ...fixture(), token: 'json-file', path: 'E:\\new.json', name: 'new.json' }))
    const state = manager.getState(id)!
    expect(await files.save(id)).toBe(true)
    expect(manager.metadata(id)).toMatchObject({ fileToken: 'json-file', language: 'JSON', dirty: false, path: 'E:\\new.json' })
    expect(manager.getState(id)!.doc).toBe(state.doc)
    expect(applyHistory(manager, id)).toBe(true); expect(manager.metadata(id)!.dirty).toBe(true)
    manager.dispose()
  })
  it('另存为显式转换 UTF-8，编码重开期间新修改拒绝替换', async () => {
    const { manager, files, gateway } = setup(); files.accept(fixture({ encoding: 'windows-1252', bom: false })); const id = manager.activeId!
    expect(await files.save(id, true, 'UTF-8')).toBe(true)
    expect(vi.mocked(gateway.save).mock.calls[0].slice(3)).toEqual(['UTF-8', false])
    const pending = deferred<OpenFile>(); gateway.reopen = vi.fn(() => pending.promise)
    const reopening = files.reopen('UTF-8')
    manager.dispatch(id, { changes: { from: 0, insert: '重开期间输入' } })
    pending.resolve(fixture({ text: '磁盘内容' })); await reopening
    expect(manager.getText(id)).toContain('重开期间输入')
    manager.dispose()
  })
  it('关闭授权释放，重新打开读取新内容；取消 dirty 关闭不释放', async () => {
    const { manager, files, gateway } = setup(); files.accept(fixture()); const id = manager.activeId!
    manager.dispatch(id, { changes: { from: 0, insert: 'dirty' } })
    expect(files.close(id)).toBe('dirty'); expect(gateway.release).not.toHaveBeenCalled()
    expect(files.close(id, true)).toBe('closed'); expect(gateway.release).toHaveBeenCalledWith('file-1')
    expect(manager.catalog).toHaveLength(0)
    files.accept(fixture({ text: '更新的磁盘内容' })); expect(manager.getText(manager.activeId!)).toBe('更新的磁盘内容')
    manager.dispose()
  })
  it('取消另存为、组件卸载和延迟响应不会留下目标授权', async () => {
    const { manager, files, gateway } = setup(); const id = manager.createUntitled()!
    const pending = deferred<{ token: string; path: string; version: null }>()
    gateway.saveTarget = vi.fn(() => pending.promise)
    const save = files.save(id); files.dispose(); manager.dispose()
    pending.resolve({ token: 'late-target', path: 'E:\\late.txt', version: null })
    expect(await save).toBe(false); expect(gateway.release).toHaveBeenCalledWith('late-target')
    expect(gateway.save).not.toHaveBeenCalled()
  })
})
