import { describe, it, expect } from 'vitest'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { defaultImageRules, imageRulesFrom, imageDirectory, imageMarkdown, imageRuleKey, ImageImporter, type ImageGateway } from '../src/editor/markdown/imageImport'
import { defaultSettings, settingsFrom } from '../src/features/shell/editorSettings'
import { imageDestination } from '../src/editor/markdown/images'
import { createMarkdownRenderer } from '../src/editor/markdown/rendering'

const rules=defaultImageRules()
function fixture(saved=true) {
  const manager=new DocumentManager([],async()=>[])
  const id=saved ? manager.openFile({token:'md',path:'C:/笔记/note.md',name:'note.md',text:'hello',encoding:'UTF-8',bom:false,eol:'LF',readOnly:false,version:'1',kind:'text'})! : manager.createUntitled('md')!
  return {manager,id}
}
function gateway(overrides:Partial<ImageGateway>={}):ImageGateway {
  return {import:async()=>({path:'C:/笔记/assets/image.png',name:'image.png'}),authorize:async()=>false,release:async()=>{},...overrides}
}
describe('图片规则与 Markdown 路径',()=>{
  it('默认 assets、文件名变量、同级和保留原始文件，截图有归属',()=>{
    expect(imageDirectory(rules,'中文 笔记.md')).toBe('./assets/')
    expect(imageDirectory({...rules,location:'document'},'中文 笔记.markdown')).toBe('./中文 笔记.assets/')
    expect(imageDirectory({...rules,location:'custom',customDirectory:'./media/${filename}/${filename}'},'a.md')).toBe('./media/a/a')
    expect(imageDirectory({...rules,location:'sibling'},'a.md')).toBe('.')
    expect(imageDirectory({...rules,location:'original'},'a.md')).toBeNull()
    expect(imageDirectory({...rules,location:'original'},'a.md',true)).toBe('./assets/')
  })
  it('相对路径、前缀、跨盘回退与绝对路径',()=>{
    expect(imageMarkdown('C:/笔记/assets/image.png','C:/笔记/note.md','image.png',rules)).toBe('![image](./assets/image.png)')
    expect(imageMarkdown('C:/a.png','C:/docs/note.md','a.png',rules)).toBe('![a](../a.png)')
    expect(imageMarkdown('D:/a.png','C:/docs/note.md','a.png',rules)).toBe('![a](D:/a.png)')
    expect(imageMarkdown('C:/docs/a.png','C:/docs/note.md','a.png',{...rules,dotPrefix:false})).toBe('![a](a.png)')
    expect(imageMarkdown('/docs/a.png','/docs/note.md','a.png',{...rules,relative:false})).toBe('![a](/docs/a.png)')
  })
  it('中文空格括号百分号路径可逆，非转义语法保持可解析',()=>{
    for(const escape of [true,false]){
      const md=imageMarkdown('C:/docs/assets/中文 (1) #%25.png','C:/docs/a.md','中[文].png',{...rules,escape})
      const html=createMarkdownRenderer().render(md)
      expect(html).toContain('md-image-slot')
      const destination=md.slice(md.indexOf('](')+2,-1)
      expect(imageDestination(destination)).toEqual({kind:'local',path:'./assets/中文 (1) #%25.png'})
    }
  })
  it('识别 Windows 原生扩展路径且文档键大小写无歧义',()=>{
    expect(imageMarkdown('\\\\?\\C:\\Docs\\assets\\a.png','\\\\?\\C:\\Docs\\a.md','a.png',rules)).toBe('![a](./assets/a.png)')
    expect(imageRuleKey('\\\\?\\C:\\Docs\\a.md')).toBe('c:/docs/a.md')
  })
  it('旧设置迁移与全局/文档规则独立持久化',()=>{
    expect(settingsFrom({}).imageRules).toEqual(rules)
    const input={...defaultSettings(),imageRules:{...rules,location:'original'},documentImageRules:{'c:/a.md':{...rules,location:'document'}}}
    const result=settingsFrom(JSON.parse(JSON.stringify(input)))
    expect(result.imageRules.location).toBe('original');expect(result.documentImageRules['c:/a.md'].location).toBe('document')
    expect(imageRulesFrom({location:'invalid',relative:'yes'})).toEqual(rules)
  })
})
describe('统一导入服务：事务与失败边界',()=>{
  it('成功后才插入，异步复制期间编辑映射位置，撤销仅撤销插图',async()=>{
    const {manager,id}=fixture();manager.dispatch(id,{selection:{anchor:5}})
    let finish!:(value:{path:string;name:string})=>void
    const pending=new Promise<{path:string;name:string}>(resolve=>finish=resolve)
    const importer=new ImageImporter(manager,gateway({import:()=>pending}),async()=>true,()=>rules)
    const task=importer.insert(id,[{token:'image',name:'image.png'}])
    expect(manager.getText(id)).toBe('hello')
    manager.dispatch(id,{changes:{from:0,insert:'new '}})
    finish({path:'C:/笔记/assets/image.png',name:'image.png'});await task
    expect(manager.getText(id)).toBe('new hello![image](./assets/image.png)\n')
    manager.command('undo');expect(manager.getText(id)).toBe('new hello')
    manager.dispose()
  })
  it('写入失败保留源码、选区和编辑历史',async()=>{
    const {manager,id}=fixture();manager.dispatch(id,{selection:{anchor:1,head:4}})
    const importer=new ImageImporter(manager,gateway({import:async()=>{throw Error('read only')}}),async()=>true,()=>rules)
    await expect(importer.insert(id,[{token:'image',name:'image.png'}])).rejects.toThrow('read only')
    expect(manager.getText(id)).toBe('hello');expect(manager.metadata(id)?.dirty).toBe(false)
    expect(manager.getState(id)?.selection.main.from).toBe(1);manager.dispose()
  })
  it('取消 Untitled 保存不会调用文件写入',async()=>{
    const {manager,id}=fixture(false);let writes=0,released:string[]=[]
    const importer=new ImageImporter(manager,gateway({import:async()=>{writes++;throw Error('unexpected')},release:async tokens=>{released=tokens}}),async()=>false,()=>rules)
    await importer.insert(id,[{token:'image',name:'image.png'}]);expect(writes).toBe(0);expect(released).toEqual(['image']);expect(manager.getText(id)).toBe('');manager.dispose()
  })
  it('文档外目录取消授权不写引用，授权后只重试受限导入',async()=>{
    for(const approved of [false,true]){
      const {manager,id}=fixture();let calls=0
      const importer=new ImageImporter(manager,gateway({import:async()=>{if(++calls===1)throw {code:'image_directory_permission'};return {path:'C:/shared/image.png',name:'image.png'}},authorize:async()=>approved}),async()=>true,()=>({...rules,location:'custom',customDirectory:'../shared'}))
      await importer.insert(id,[{token:'image',name:'image.png'}]);expect(calls).toBe(approved?2:1);expect(manager.getText(id)?.includes('![image]')).toBe(approved);manager.dispose()
    }
  })
  it('导入期间切换标签仍写入原文档，关闭后不写入其他文档',async()=>{
    const {manager,id}=fixture();let finish!:(value:{path:string;name:string})=>void
    const importer=new ImageImporter(manager,gateway({import:()=>new Promise(resolve=>finish=resolve)}),async()=>true,()=>rules)
    const task=importer.insert(id,[{token:'image',name:'image.png'}]);const other=manager.createUntitled()!
    finish({path:'C:/笔记/assets/image.png',name:'image.png'});await task
    expect(manager.getText(id)).toContain('![image]');expect(manager.getText(other)).toBe('');manager.dispose()
  })
})
