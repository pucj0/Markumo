import { afterEach,describe,it,expect,vi } from 'vitest'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { FileController } from '../src/features/files/FileController'
import { WorkspaceController } from '../src/features/workspace/WorkspaceController'
import { treeWindow } from '../src/features/workspace/virtualTree'
import type { WorkspaceGateway,WorkspaceNode } from '../src/features/workspace/contracts'
import type { FileGateway } from '../src/features/files/contracts'
const cleanups:(()=>void)[]=[]
afterEach(()=>cleanups.splice(0).forEach(fn=>fn()))
const node=(path:string,dir=false):WorkspaceNode=>({id:path,name:path.split('/').pop()!,path,relativePath:path,isDirectory:dir,isSymlink:false,isReadOnly:false,size:0,mtime:null,hasChildren:dir})
function setup(){
  const dirs=new Map<string,WorkspaceNode[]>([['C:/a',[node('C:/a/src',true),node('C:/a/root.txt')]],['C:/a/src',[node('C:/a/src/deep',true)]],['C:/a/src/deep',[node('C:/a/src/deep/当前 文件.md')]],['C:/b',[node('C:/b/lib',true)]],['C:/b/lib',[node('C:/b/lib/b.cmd')]]])
  const read=vi.fn(async(path:string)=>{if(!dirs.has(path))throw Error('missing directory');return dirs.get(path)!.map(item=>({...item}))})
  const manager=new DocumentManager([],async()=>[]),files=new FileController(manager,{release:vi.fn(async()=>{})} as unknown as FileGateway,()=>{}),notify=vi.fn()
  const gateway={readDirectory:read,getRecentWorkspaces:vi.fn(async()=>[]),openWorkspacePath:async(path:string)=>({rootPath:path,name:path.split('/').pop()!,entries:await read(path)}),removeWorkspaceFolder:vi.fn(async()=>{})} as unknown as WorkspaceGateway
  const controller=new WorkspaceController(gateway,manager,files,notify,false)
  cleanups.push(()=>{controller.destroy();files.dispose();manager.dispose()})
  return {controller,read,manager,files,notify,dirs}
}
describe('工作区真实控制器工具（单元gateway显式替身）',()=>{
  it('定位懒加载目录链，不创建标签或修改文档',async()=>{
    const s=setup();await s.controller.openWorkspacePath('C:/a');expect(await s.controller.revealFileInTree('C:/a/src/deep/当前 文件.md')).toBe(true)
    const src=s.controller.roots[0].entries[0];expect(src.isExpanded).toBe(true);expect(src.children?.[0].isExpanded).toBe(true);expect(s.manager.openedDocuments).toEqual([])
    expect(s.read).toHaveBeenCalledWith('C:/a/src');expect(s.read).toHaveBeenCalledWith('C:/a/src/deep')
  })
  it('多工作区、Windows扩展路径和嵌套根定位选择正确授权根',async()=>{
    const s=setup();await s.controller.openWorkspacePath('C:/a');await s.controller.openWorkspacePath('C:/b',true)
    expect(await s.controller.revealFileInTree('\\\\?\\c:\\B\\lib\\b.cmd')).toBe(true);expect(s.controller.roots[1].entries[0].isExpanded).toBe(true);expect(s.controller.roots[0].entries[0].isExpanded).toBeFalsy()
    s.dirs.set('C:/a/src',[node('C:/a/src/a.bat')]);await s.controller.openWorkspacePath('C:/a/src',true);expect(s.controller.rootForPath('C:/a/src/a.bat')).toBe('C:/a/src');expect(s.controller.rootForPath('C:/a-extra/x')).toBeNull()
  })
  it('显式定位刷新目标目录，删除/不属于工作区的文件不会伪定位',async()=>{
    const s=setup();await s.controller.openWorkspacePath('C:/a');expect(await s.controller.revealFileInTree('C:/outside.txt',true)).toBe(false)
    expect(await s.controller.revealFileInTree('C:/a/root.txt',true)).toBe(true);s.dirs.set('C:/a',[node('C:/a/src',true)]);expect(await s.controller.revealFileInTree('C:/a/root.txt',true)).toBe(false)
  })
  it('全部展开真实加载所有根的多层目录，收起保留已加载数据',async()=>{
    const s=setup();await s.controller.openWorkspacePath('C:/a');await s.controller.openWorkspacePath('C:/b',true);const result=await s.controller.expandAll()
    expect(result.limited).toBe(false);expect(s.read).toHaveBeenCalledWith('C:/b/lib');expect(s.read).toHaveBeenCalledWith('C:/a/src/deep')
    const src=s.controller.roots[0].entries[0];expect(src.children?.[0].isExpanded).toBe(true);s.controller.collapseAll();expect(src.isExpanded).toBe(false);expect(src.children?.[0].isExpanded).toBe(false);expect(src.children?.[0].children).toHaveLength(1)
  })
  it('目录/节点/深度预算真实限制请求，保留手动展开能力',async()=>{
    const s=setup();await s.controller.openWorkspacePath('C:/a');await s.controller.openWorkspacePath('C:/b',true);s.read.mockClear()
    expect((await s.controller.expandAll({maxDirectories:1})).limited).toBe(true);expect(s.read).toHaveBeenCalledTimes(1);expect(s.notify).toHaveBeenCalledWith(expect.stringContaining('预算'))
    s.controller.collapseAll();expect((await s.controller.expandAll({maxNodes:1})).limited).toBe(true)
    s.controller.collapseAll();expect((await s.controller.expandAll({maxDepth:1})).limited).toBe(true)
    await s.controller.toggleFolder(s.controller.roots[0].entries[0].children![0]);expect(s.controller.roots[0].entries[0].children![0].isExpanded).toBe(true)
  })
  it('取消在途读取后不重新展开被用户收起的目录',async()=>{
    const s=setup();await s.controller.openWorkspacePath('C:/a');let resolve!:(nodes:WorkspaceNode[])=>void;s.read.mockImplementationOnce(()=>new Promise(done=>{resolve=done}))
    const task=s.controller.expandAll();expect(s.controller.expanding).toBe(true);s.controller.collapseAll();resolve([node('C:/a/src/end.txt')]);expect((await task).canceled).toBe(true);expect(s.controller.roots[0].entries[0].isExpanded).toBe(false);expect(s.controller.expanding).toBe(false)
  })
  it('定位与已有目录读取共用请求，读取失败不假展开',async()=>{
    const s=setup();await s.controller.openWorkspacePath('C:/a');let resolve!:(nodes:WorkspaceNode[])=>void;s.read.mockImplementationOnce(()=>new Promise(done=>{resolve=done}));s.read.mockClear()
    const src=s.controller.roots[0].entries[0],open=s.controller.toggleFolder(src),locate=s.controller.revealFileInTree('C:/a/src/end.txt');resolve([node('C:/a/src/end.txt')]);await open;expect(await locate).toBe(true);expect(s.read).toHaveBeenCalledTimes(1)
    src.children=undefined;src.isExpanded=false;s.read.mockRejectedValueOnce(Error('denied'));await s.controller.toggleFolder(src);expect(src.isExpanded).toBe(false);expect(s.notify).toHaveBeenCalledWith(expect.stringContaining('denied'))
  })
  it('移除根后在途读取不能重新接入旧目录',async()=>{
    const s=setup();await s.controller.openWorkspacePath('C:/a');let resolve!:(nodes:WorkspaceNode[])=>void;s.read.mockImplementationOnce(()=>new Promise(done=>{resolve=done}));const task=s.controller.expandAll();await s.controller.removeFolder('C:/a');resolve([node('C:/a/src/end.txt')]);expect((await task).canceled).toBe(true);expect(s.controller.roots).toEqual([])
  })
  it('拒绝符号链接及不递增路径，避免目录循环',async()=>{
    const s=setup();s.dirs.set('C:/a/src',[node('C:/a/src',true),{...node('C:/a/src/link',true),isSymlink:true}]);await s.controller.openWorkspacePath('C:/a');expect((await s.controller.expandAll()).limited).toBe(false);expect(s.controller.roots[0].entries[0].children).toEqual([])
  })
  it('虚拟行数覆盖任意窗口高度、100+节点、末尾与折叠后的滚动范围',()=>{
    for(const height of [26,300,780,2000])for(const scroll of [0,1300,260000,999999]){
      const window=treeWindow(10000,scroll,height);expect(window.count).toBeGreaterThanOrEqual(Math.ceil(height/26));expect(window.start+window.count).toBeLessThanOrEqual(10000);expect(window.before+window.after+window.count*26).toBe(260000)
    }
    const last=treeWindow(3,999999,780);expect(last.start).toBe(0);expect(last.count).toBe(3)
  })
})
