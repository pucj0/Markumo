import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { FileController } from '../src/features/files/FileController'
import { AutoSaveController } from '../src/features/files/AutoSaveController'
import { defaultSettings, settingsFrom } from '../src/features/shell/editorSettings'
import type { FileGateway, FileMetadata, OpenFile } from '../src/features/files/contracts'

const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.useRealTimers() })
function setup() {
  vi.useFakeTimers()
  const manager = new DocumentManager([], async () => [])
  const file: OpenFile = {token:'test-token',path:'E:\\fixture.txt',name:'fixture.txt',text:'中文\r\n原文',encoding:'UTF-8',eol:'CRLF',bom:true,readOnly:false,version:'v1'}
  const save = vi.fn(async (token: string): Promise<FileMetadata> => ({...file, token, version:'v2'}))
  const target = vi.fn(), notify = vi.fn()
  const files = new FileController(manager, { save, saveTarget: target, release: vi.fn(async () => {}) } as unknown as FileGateway, notify)
  let blocked = false
  const autosave = new AutoSaveController(manager, files, () => blocked)
  const id = manager.openFile(file)!
  autosave.configure(true, 500)
  cleanups.push(() => { autosave.dispose(); files.dispose(); manager.dispose() })
  const edit = (text: string, doc = id) => manager.dispatch(doc, {changes:{from:manager.getState(doc)!.doc.length,insert:text}})
  return { manager, files, autosave, id, file, save, target, notify, edit, block: (value: boolean) => { blocked = value } }
}
describe('automatic saves use the existing safe file controller', () => {
  it('defaults on, preserves explicit off and rejects invalid delays in old settings', () => {
    expect(defaultSettings().autoSave).toBe(true)
    expect(settingsFrom({theme:'dark'}).autoSaveDelay).toBe(1500)
    expect(settingsFrom({autoSave:false,autoSaveDelay:3000})).toMatchObject({autoSave:false,autoSaveDelay:3000})
    expect(settingsFrom({autoSaveDelay:0}).autoSaveDelay).toBe(1500)
  })
  it('debounces text edits but not cursor movement, shares one save across split views and keeps encoding', async () => {
    const s = setup(); s.manager.splitEditor(); s.edit('a')
    await vi.advanceTimersByTimeAsync(400); s.edit('b')
    await vi.advanceTimersByTimeAsync(300); s.manager.dispatch(s.id,{selection:{anchor:1}})
    await vi.advanceTimersByTimeAsync(199); expect(s.save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(s.save).toHaveBeenCalledTimes(1)
    expect(s.save).toHaveBeenCalledWith('test-token','中文\r\n原文ab','v1','UTF-8',true)
    expect(s.manager.metadata(s.id)?.dirty).toBe(false)
    expect(s.notify).not.toHaveBeenCalled(); expect(s.target).not.toHaveBeenCalled()
  })
  it('does not open save dialogs for drafts or write read-only paths, and cancels pending work when disabled/disposed', async () => {
    const s=setup(); const draft=s.manager.createUntitled()!;s.edit('draft',draft)
    const readonly=s.manager.openFile({...s.file,token:'readonly',path:'E:\\readonly.txt',name:'readonly.txt',readOnly:true})!;s.edit('readonly',readonly)
    await vi.advanceTimersByTimeAsync(2000);expect(s.save).not.toHaveBeenCalled();expect(s.target).not.toHaveBeenCalled()
    s.edit('change');s.autosave.configure(false,500);await vi.advanceTimersByTimeAsync(1000);expect(s.save).not.toHaveBeenCalled()
    s.autosave.configure(true,500);s.autosave.dispose();await vi.advanceTimersByTimeAsync(1000);expect(s.save).not.toHaveBeenCalled()
  })
  it('defers composition, workspace operations and confirmation dialogs without notifying or losing pending edits', async () => {
    const s=setup();const composing=vi.spyOn(s.manager,'isComposing','get').mockReturnValue(true)
    s.edit('IME');await vi.advanceTimersByTimeAsync(1000);expect(s.save).not.toHaveBeenCalled()
    composing.mockReturnValue(false);s.files.workspaceBusy=true;await vi.advanceTimersByTimeAsync(500);expect(s.save).not.toHaveBeenCalled()
    s.files.workspaceBusy=false;s.block(true);await vi.advanceTimersByTimeAsync(500);expect(s.save).not.toHaveBeenCalled()
    s.block(false);await vi.advanceTimersByTimeAsync(250);expect(s.save).toHaveBeenCalledTimes(1);expect(s.notify).not.toHaveBeenCalled()
  })
  it('retains newer edits while IPC is in flight and saves the next snapshot using the returned version', async () => {
    const s=setup();let finish!: (meta: FileMetadata) => void
    s.save.mockImplementationOnce(() => new Promise(resolve=>{finish=resolve}))
    s.edit('A');await vi.advanceTimersByTimeAsync(500);expect(s.save).toHaveBeenCalledTimes(1)
    expect(s.files.close(s.id,true)).toBe('saving')
    s.edit('B');await vi.advanceTimersByTimeAsync(300);finish({...s.file,version:'v2'});await vi.advanceTimersByTimeAsync(0)
    expect(s.manager.metadata(s.id)?.dirty).toBe(true)
    await vi.advanceTimersByTimeAsync(200);expect(s.save).toHaveBeenCalledTimes(2)
    expect(s.save.mock.calls[1]).toEqual(['test-token','中文\r\n原文AB','v2','UTF-8',true])
    expect(s.manager.metadata(s.id)?.dirty).toBe(false)
  })
  it('pauses failures across further edits; a successful manual save clears the pause, with no forced overwrite', async () => {
    const s=setup();s.save.mockRejectedValueOnce(new Error('磁盘版本冲突'))
    s.edit('A');await vi.advanceTimersByTimeAsync(500);expect(s.manager.metadata(s.id)?.dirty).toBe(true)
    s.edit('B');await vi.advanceTimersByTimeAsync(3000);expect(s.save).toHaveBeenCalledTimes(1)
    expect(s.notify).toHaveBeenCalledTimes(1);expect(s.notify.mock.calls[0][0]).toContain('自动保存已暂停')
    expect(s.manager.saveSnapshot(s.id)?.text).toBe('中文\r\n原文AB')
    expect(await s.files.save(s.id)).toBe(true);s.edit('C');await vi.advanceTimersByTimeAsync(500)
    expect(s.save).toHaveBeenCalledTimes(3)
  })
  it('serializes different files and does not restart a pending manual save', async () => {
    const s=setup();const second=s.manager.openFile({...s.file,token:'second',path:'E:\\second.txt',name:'second.txt'})!
    s.edit('A');s.edit('B',second);await vi.advanceTimersByTimeAsync(500)
    expect(s.save).toHaveBeenCalledTimes(2);expect(s.manager.metadata(s.id)?.dirty).toBe(false);expect(s.manager.metadata(second)?.dirty).toBe(false)
    s.edit('C');let finish!: (meta:FileMetadata)=>void;s.save.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
    const saving=s.files.save(s.id);await vi.advanceTimersByTimeAsync(1000);expect(s.save).toHaveBeenCalledTimes(3)
    finish({...s.file,version:'v3'});await saving;await vi.advanceTimersByTimeAsync(500);expect(s.save).toHaveBeenCalledTimes(3)
  })
})
