import { describe,it,expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { EditorState, EditorSelection } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { continueMarkdownMarkup as insertNewlineContinueMarkup } from '../src/editor/markdown/smartEditing'
import { undo } from '@codemirror/commands'
import { coreExtensions } from '../src/editor/core/extensions'
import { loadLanguage } from '../src/editor/languages'
import { livePreviewExtension,buildLiveDecorationsForState } from '../src/editor/markdown/livePreview'
import { imageField } from '../src/editor/markdown/imageField'
import { imageDestination } from '../src/editor/markdown/images'
import { createMarkdownRenderer } from '../src/editor/markdown/rendering'
import { DocumentManager } from '../src/editor/core/DocumentManager'
import { fenceModel } from '../src/editor/markdown/codeFence'
import { syntaxTree } from '@codemirror/language'

const fixture=readFileSync(new URL('./fixtures/markdown-stage-a.md',import.meta.url),'utf8')
async function state(doc:string, positions=[doc.length], live=false) {
  let state=EditorState.create({doc,selection:EditorSelection.create(positions.map(position=>EditorSelection.cursor(position))),extensions:[coreExtensions,await loadLanguage('Markdown'),live?livePreviewExtension():[]]})
  ensureSyntaxTree(state,state.doc.length,1000);return state.update({}).state
}
describe('阶段 A：真实解析/事务与渲染语义',()=>{
  it.each([
    ['- 中文','- 中文\n- '],['3. third','3. third\n4. '],['- [x] done','- [x] done\n- [ ] '],
    ['> 引用','> 引用\n> '],['> > nested','> > nested\n> > '],['- ',''],['- [ ] ',''],['> quoted\n> ','> quoted\n'],['> > ','> '],['> ',''],
  ])('Enter续写与退出 %j',async(source,expected)=>{
    let current=await state(source)
    expect(insertNewlineContinueMarkup({state:current,dispatch:tr=>{current=tr.state}})).toBe(true)
    expect(current.doc.toString()).toBe(expected)
    expect(undo({state:current,dispatch:tr=>{current=tr.state}})).toBe(true)
    expect(current.doc.toString()).toBe(source)
  })
  it('嵌套列表和多光标一次事务续写，代码块不会误续写',async()=>{
    const source='- one\n  - nested\n\n- two'
    let current=await state(source,[source.indexOf('\n\n'),source.length])
    expect(insertNewlineContinueMarkup({state:current,dispatch:tr=>{current=tr.state}})).toBe(true)
    expect(current.doc.toString()).toBe('- one\n  - nested\n  - \n\n- two\n\n- ')
    const code=await state('```js\n- no list\n```',[15])
    expect(insertNewlineContinueMarkup({state:code,dispatch:()=>{throw new Error('must not edit code')}})).toBe(false)
  })
  it('真实fixture覆盖H1-H6、列表/引用/强调/围栏，块图片装饰由StateField提供且选择恢复源码',async()=>{
    let current=await state(fixture,[fixture.length],true)
    const classes:string[]=[]
    buildLiveDecorationsForState(current).between(0,current.doc.length,(_f,_t,value)=>{classes.push(value.spec.class||'')})
    for(let i=1;i<=6;i++)expect(classes.some(value=>value.includes(`cm-md-h${i}`))).toBe(true)
    const blocks:{from:number;to:number}[]=[]
    current.field(imageField).decorations.between(0,current.doc.length,(from,to,value)=>{if(value.spec.block)blocks.push({from,to})})
    expect(blocks.length).toBe(3)
    const target=blocks[0]
    current=current.update({selection:EditorSelection.range(target.from,target.to)}).state
    let hidden=false;current.field(imageField).decorations.between(target.from,target.to,()=>{hidden=true})
    expect(hidden).toBe(false);expect(current.doc.toString()).toBe(fixture)
  })
  it('围栏复制范围来自原始文本，包含语言标签且未知语言安全降级',async()=>{
    const current=await state(fixture),fences=syntaxTree(current).topNode.getChildren('FencedCode')
    expect(fences.length).toBe(4)
    const model=fenceModel(current,fences[0]);expect(model.language).toBe('js')
    expect(current.sliceDoc(model.from,model.to)).toBe('const message = "中文 English";\nconsole.log(message);')
  })
  it('Live与Split共享任务、换行、图片路径、表格语义，禁用原始HTML和自动标点',async()=>{
    const md=createMarkdownRenderer(),html=md.render(fixture)
    expect(html).toContain('<h1>');expect(html).toContain('<h6>');expect(html).toContain('<table>')
    expect(html).toContain('type="checkbox" disabled');expect(html).toContain('checked')
    expect(html).toContain('<br>');expect(html).toContain('md-image-slot');expect(html).not.toContain('<img')
    expect(md.render('<script>alert(1)</script>')).not.toContain('<script>')
    expect(md.render('"straight" -- ...')).toContain('&quot;straight&quot; -- ...')
    expect(md.render('![bad](javascript:alert(1))')).not.toContain('<img')
    expect(md.render('| a |\n| - |\n| ![x](a.png) |')).not.toContain('md-image-slot')
  })
  it('图片目的地拒绝任意file/data/脚本与凭据，只允许授权相对路径或受控HTTPS',()=>{
    for(const source of ['file:///secret.png','data:image/svg+xml,x','javascript:x','//host/a','C:\\a.png','https://u:p@example.com/a','http://example.com/a'])expect(imageDestination(source).kind).toBe('blocked')
    expect(imageDestination('../assets/中文%20图片.png')).toEqual({kind:'local',path:'../assets/中文 图片.png'})
    expect(imageDestination('https://example.com/a').kind).toBe('remote')
  })
  it('Live与Split都识别常规HTTP链接、裸URL和尖括号链接，不调用不安全协议',async()=>{
    const text='outside\n\n[link](https://example.com) https://example.org <https://example.net>'
    const current=await state(text,[0]),urls:string[]=[]
    buildLiveDecorationsForState(current).between(0,text.length,(_f,_t,value)=>{const url=value.spec.attributes?.['data-md-link'];if(url)urls.push(url)})
    for(const url of ['https://example.com/','https://example.org/','https://example.net/'])expect(urls).toContain(url)
    expect((createMarkdownRenderer().render(text).match(/<a /g)||[]).length).toBe(3)
  })
  it('模式切换/复杂选区不修改原始Markdown、BOM/混合换行；普通文本不加载Markdown交互',async()=>{
    const manager=new DocumentManager()
    const text=fixture.replace(/\n/g,'\r\n')
    const id=manager.openFile({token:'stage-a',name:'fixture.md',path:'E:\\fixture.md',text,encoding:'UTF-8',bom:true,eol:'CRLF',readOnly:false,version:'v1'})!
    for(const mode of ['source','split','live','split','source','live'] as const) {
      manager.setMarkdownMode(id,mode)
      manager.dispatch(id,{selection:EditorSelection.create([EditorSelection.range(3,180),EditorSelection.cursor(250)])})
      expect(manager.saveSnapshot(id)!.text).toBe(text);expect(manager.metadata(id)!.dirty).toBe(false)
    }
    const plain=manager.openFile({token:'plain',name:'notes.txt',path:'E:\\notes.txt',text:'- plain',encoding:'UTF-8',bom:false,eol:'LF',readOnly:false,version:'v1'})!
    expect(manager.metadata(plain)!.mode).toBeUndefined();expect(manager.setMarkdownMode(plain,'live')).toBe(false)
    manager.dispose()
  })
  it('另存为更换文档授权后图片资源身份更新，不继续显示原目录缓存',async()=>{
    const manager=new DocumentManager(),file={token:'old',name:'doc.md',path:'E:\\old\\doc.md',text:'![x](pixel.png)\n\nend',encoding:'UTF-8' as const,bom:false,eol:'LF' as const,readOnly:false,version:'v1'}
    const id=manager.openFile(file)!
    await manager.setLanguage(id,'Markdown')
    const identity=()=>{const keys:string[]=[];manager.getState(id)!.field(imageField).decorations.between(0,file.text.length,(_f,_t,value)=>{if(value.spec.widget)keys.push(value.spec.widget.resourceKey)});return keys}
    manager.dispatch(id,{selection:{anchor:file.text.length}})
    expect(identity()).toEqual(['old|E:\\old\\doc.md'])
    manager.saveSnapshot(id)!.complete({...file,token:'new',path:'E:\\new\\doc.md',version:'v2'})
    expect(identity()).toEqual(['new|E:\\new\\doc.md']);expect(manager.saveSnapshot(id)!.text).toBe(file.text)
    manager.renamePath('E:\\new\\doc.md','E:\\moved\\doc.md','doc.md')
    await manager.setLanguage(id,'Markdown')
    expect(identity()).toEqual(['new|E:\\moved\\doc.md'])
    manager.dispose()
  })
})
