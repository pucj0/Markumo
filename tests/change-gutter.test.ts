import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { isolateHistory } from '@codemirror/commands'
import { changeGutterField, changedLines } from '../src/editor/core/changeGutter'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { FileController } from '../src/features/files/FileController'
import { AutoSaveController } from '../src/features/files/AutoSaveController'
import { detectLanguage } from '../src/editor/languages'
import type { TextOpenFile,FileGateway,FileMetadata,Encoding } from '../src/features/files/contracts'
const cleanups:(()=>void)[]=[]
afterEach(()=>{cleanups.splice(0).forEach(fn=>fn());vi.useRealTimers()})
function setup(text='one\r\ntwo\r\nthree',name='test.txt'){
  const manager=new DocumentManager([],async()=>[])
  const file:TextOpenFile={token:'token',name,path:`E:/fixture/${name}`,text,encoding:'UTF-8',bom:true,eol:'CRLF',readOnly:false,version:'v1'}
  const save=vi.fn(async(token:string,_text:string,_version:string|null,encoding:Encoding,bom:boolean):Promise<FileMetadata>=>({...file,token,encoding,bom,version:'v2'}))
  const target=vi.fn(async()=>({...file,token:'target',version:null}))
  const files=new FileController(manager,{save,saveTarget:target,release:vi.fn(async()=>{})} as unknown as FileGateway,()=>{})
  const id=manager.openFile(file)!
  cleanups.push(()=>{files.dispose();manager.dispose()})
  const edit=(from:number,to:number,insert:string)=>manager.dispatch(id,{changes:{from,to,insert},annotations:isolateHistory.of('full')})
  const marks=()=>changedLines(manager.getState(id)!)
  return {manager,files,id,edit,marks,file,save,target}
}
describe('与上次成功保存文本比较的行级 gutter',()=>{
  it('打开文件无标记，修改原有行仅标记该行',()=>{
    const s=setup();expect(s.marks()).toEqual([]);s.edit(5,6,'W');expect(s.marks()).toEqual([{line:2,kind:'modified'}])
  })
  it('前面插入整行不误标后续未变行，原有修改随行号偏移',()=>{
    const s=setup();s.edit(5,6,'W');s.edit(0,0,'new\n')
    expect(s.marks()).toEqual([{line:1,kind:'inserted'},{line:3,kind:'modified'}])
  })
  it('删除整行不将后面的未修改行染橙，保留细小删除标记',()=>{
    const s=setup();s.edit(0,4,'');expect(s.marks()).toEqual([{line:1,kind:'deleted'}]);expect(s.manager.getText(s.id)).toBe('two\nthree')
  })
  it('中间/末尾插入、多段原有修改按真实行差异计算',()=>{
    const s=setup();s.edit(4,4,'new\n');s.edit(0,1,'O');s.edit(s.manager.getState(s.id)!.doc.length,s.manager.getState(s.id)!.doc.length,'\nlast')
    expect(s.marks()).toEqual([{line:1,kind:'modified'},{line:2,kind:'inserted'},{line:5,kind:'inserted'}])
  })
  it('修改行前插入新行仍保持新行绿色，重复文本行保留真实插入位置',()=>{
    const s=setup();s.edit(4,7,'TWO');s.edit(4,4,'new\n');expect(s.marks()).toEqual([{line:2,kind:'inserted'},{line:3,kind:'modified'}])
    const duplicate=setup('x\nx\nx');duplicate.edit(0,0,'x\n');expect(duplicate.marks()).toEqual([{line:1,kind:'inserted'}])
  })
  it('部分撤销删除不能将恢复的原有行误当新行',()=>{
    const s=setup();s.edit(0,1,'O');s.edit(4,8,'');s.manager.command('undo');expect(s.marks()).toEqual([{line:1,kind:'modified'}]);s.manager.command('redo');expect(s.marks()).toEqual([{line:1,kind:'modified'},{line:2,kind:'deleted'}])
  })
  it('拆分行时保留原行修改语义，新增后半行绿色',()=>{
    const s=setup();s.edit(1,1,'\n');expect(s.marks()).toEqual([{line:1,kind:'modified'},{line:2,kind:'inserted'}])
  })
  it('撤销/重做及手动恢复原文清除正确标记',()=>{
    const s=setup();s.edit(0,0,'new\n');s.manager.command('undo');expect(s.marks()).toEqual([])
    s.manager.command('redo');expect(s.marks()).toEqual([{line:1,kind:'inserted'}]);s.edit(0,4,'');expect(s.marks()).toEqual([])
    s.edit(0,1,'O');s.edit(0,1,'o');expect(s.marks()).toEqual([])
  })
  it('全文替换仍能对齐重复与未修改的中间行',()=>{
    const s=setup('a\nx\nx\nb\nx\nc');s.edit(0,s.manager.getState(s.id)!.doc.length,'A\nx\nx\nb\nx\nC')
    expect(s.marks()).toEqual([{line:1,kind:'modified'},{line:6,kind:'modified'}])
  })
  it('草稿新增行绿色，清空或撤销后恢复空白标记',()=>{
    const s=setup('');s.edit(0,0,'new\nline');expect(s.marks()).toEqual([{line:1,kind:'inserted'},{line:2,kind:'inserted'}]);s.manager.command('undo');expect(s.marks()).toEqual([])
  })
  it('手动保存成功更新基线，保存前后的撤销仍真实显示差异',async()=>{
    const s=setup();s.edit(0,1,'O');expect(await s.files.save(s.id)).toBe(true);expect(s.marks()).toEqual([])
    s.manager.command('undo');expect(s.marks()).toEqual([{line:1,kind:'modified'}]);s.manager.command('redo');expect(s.marks()).toEqual([])
  })
  it('保存进行期间的新编辑保留标记，基线使用真正送往磁盘的快照',async()=>{
    const s=setup();let finish!:(meta:FileMetadata)=>void;s.save.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
    s.edit(0,1,'O');const saving=s.files.save(s.id);s.edit(4,4,'new\n');finish({...s.file,version:'v2'});await saving
    expect(s.marks()).toEqual([{line:2,kind:'inserted'}]);expect(s.manager.metadata(s.id)?.dirty).toBe(true)
  })
  it('保存失败及另存为取消不能清除标记',async()=>{
    const s=setup();s.edit(0,1,'O');s.save.mockRejectedValueOnce(Error('conflict'));expect(await s.files.save(s.id)).toBe(false);expect(s.marks()).toEqual([{line:1,kind:'modified'}])
    s.target.mockResolvedValueOnce(null as never);expect(await s.files.save(s.id,true)).toBe(false);expect(s.marks()).toEqual([{line:1,kind:'modified'}])
  })
  it('自动保存成功清除标记，失败保留并暂停',async()=>{
    vi.useFakeTimers();const s=setup(),auto=new AutoSaveController(s.manager,s.files);cleanups.push(()=>auto.dispose());auto.configure(true,500)
    s.edit(0,1,'O');await vi.advanceTimersByTimeAsync(500);expect(s.marks()).toEqual([])
    s.save.mockRejectedValueOnce(Error('denied'));s.edit(4,5,'T');await vi.advanceTimersByTimeAsync(500);expect(s.marks()).toEqual([{line:2,kind:'modified'}]);await vi.advanceTimersByTimeAsync(2000);expect(s.save).toHaveBeenCalledTimes(2)
  })
  it('超大文件的小范围编辑不会扫描全文，大变更进入预算保护',()=>{
    const source=Array.from({length:100000},(_,i)=>`line ${i}`).join('\n'),s=setup(source)
    const line=s.manager.getState(s.id)!.doc.line(50000);s.edit(line.from,line.from+1,'L');expect(s.marks()).toEqual([{line:50000,kind:'modified'}]);expect(s.manager.getState(s.id)!.field(changeGutterField).limited).toBe(false)
    s.edit(0,s.manager.getState(s.id)!.doc.length,'changed\n'.repeat(100000));expect(s.manager.getState(s.id)!.field(changeGutterField).limited).toBe(true)
  })
  it('无界 LCS 被保护，选择/样式事务不重做行比较',()=>{
    let state=EditorState.create({doc:'a\n'.repeat(300),extensions:[changeGutterField]});state=state.update({changes:{from:0,to:state.doc.length,insert:'b\n'.repeat(300)}}).state
    expect(state.field(changeGutterField).limited).toBe(true);const field=state.field(changeGutterField);expect(state.update({selection:{anchor:2}}).state.field(changeGutterField)).toBe(field)
  })
})
describe('Windows Batch 复用真实文本内核与原始编码',()=>{
  it.each(['BAT','cmd'])('%s 是 Batch 语言模式，编辑/撤销/保存快照保留 BOM/CRLF',async ext=>{
    expect(detectLanguage(`中文 文件.${ext}`)).toBe('Batch')
    const s=setup('@echo off\r\nrem 中文\r\necho hello',`中文 文件.${ext}`);s.edit(0,0,'rem new\n');expect(s.manager.saveSnapshot(s.id)?.text).toBe('rem new\r\n@echo off\r\nrem 中文\r\necho hello')
    s.manager.command('undo');expect(s.manager.saveSnapshot(s.id)?.text).toBe(s.file.text);s.manager.command('redo');await s.files.save(s.id)
    expect(s.save).toHaveBeenCalledWith('token','rem new\r\n@echo off\r\nrem 中文\r\necho hello','v1','UTF-8',true);expect(s.marks()).toEqual([])
  })
})
