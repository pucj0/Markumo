import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {setMarkdownMode,viewCommand} from './menu-helpers.mjs'
const {chromium}=createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE||import.meta.url)('playwright')
const output='test-results/workspace-tools',fixture=`fixture-${Date.now()}`;await mkdir(output,{recursive:true})
await writeFile(`${output}/${fixture}.html`,`<!doctype html><html><head><link rel="icon" href="data:,"></head><body><div id="app"></div><script type="module" src="./${fixture}.ts"></script></body></html>`)
await writeFile(`${output}/${fixture}.ts`,`import '/src/main.ts';import {changeGutterField,changedLines} from '/src/editor/core/changeGutter';import {EditorView} from '@codemirror/view';import {AutoSaveController} from '/src/features/files/AutoSaveController';import {isolateHistory} from '@codemirror/commands';window.fixture={changeGutterField,changedLines,EditorView,AutoSaveController,isolateHistory};`)
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1200,height:780}}),errors=[],results=[]
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
const toolbar=()=>page.getByRole('toolbar',{name:'工作区工具栏'}),tree=()=>page.locator('.workspace-tree-container'),editor=()=>page.locator('.main-pane .cm-content')
const act=async script=>page.evaluate(script)
const marks=()=>page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;return window.fixture.changedLines(m.getState(m.activeId))})
const raw=()=>page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;return m.getText(m.activeId)})
const pass=name=>{results.push({name,result:'PASS'});console.log(`PASS ${name}`)}
async function theme(value){await page.getByTitle('设置',{exact:true}).click();await page.getByLabel('颜色主题',{exact:true}).selectOption(value);await page.getByRole('button',{name:'完成',exact:true}).click();await page.locator('.settingsoverlay').waitFor({state:'hidden'})}
try{
 await page.goto(`${process.env.LIGHTEDIT_TEST_URL||'http://localhost:1422'}/${output}/${fixture}.html`);await editor().waitFor()
 await act(async()=>{
  const s=document.querySelector('#app').__vue_app__._instance.setupState,n=(path,dir=false)=>({id:path,name:path.split('/').pop(),path,relativePath:path,isDirectory:dir,isSymlink:false,isReadOnly:false,size:0,mtime:null,hasChildren:dir})
  const target='C:/tree-b/pkg/deep/很长的中文 folder name 当前文件.md'
  const dirs=new Map([['C:/tree-a',[n('C:/tree-a/src',true),...Array.from({length:240},(_,i)=>n(`C:/tree-a/file-${String(i).padStart(3,'0')}.txt`))]],['C:/tree-a/src',[n('C:/tree-a/src/a.bat')]],['C:/tree-b',[n('C:/tree-b/pkg',true),...Array.from({length:120},(_,i)=>n(`C:/tree-b/file-${String(i).padStart(3,'0')}.cmd`))]],['C:/tree-b/pkg',[n('C:/tree-b/pkg/deep',true)]],['C:/tree-b/pkg/deep',[n(target)]]])
  const texts=new Map([[target,'# 标题\r\n\r\nold line\r\nsame\r\nend']]);const reads=[]
  const open=path=>({token:path,path,name:path.split('/').pop(),text:texts.get(path)||'@echo off\r\nrem safe',encoding:'UTF-8',bom:true,eol:'CRLF',readOnly:false,version:'v1'})
  Object.assign(s.workspace.gateway,{
   getRecentWorkspaces:async()=>[],readDirectory:async path=>{reads.push(path);if(!dirs.has(path))throw Error('missing');return dirs.get(path).map(node=>({...node}))},
   openWorkspacePath:async path=>({rootPath:path,name:path.split('/').pop(),entries:dirs.get(path).map(node=>({...node}))}),
   openWorkspaceFile:async path=>open(path),createFile:async(parent,name)=>{const node=n(parent+'/'+name);dirs.get(parent).push(node);texts.set(node.path,'');return {...node}},createDirectory:async(parent,name)=>{const node=n(parent+'/'+name,true);dirs.get(parent).push(node);dirs.set(node.path,[]);return {...node}},
  })
  Object.assign(s.files.gateway,{save:async(token,text,_version,encoding,bom)=>{if(window.fixture.failSave)throw Error('fixture conflict');texts.set(token,text);return {...open(token),encoding,bom,version:'v2'}},saveTarget:async()=>null,release:async()=>{}})
  Object.assign(window.fixture,{dirs,texts,reads,target,open})
  await s.workspace.openWorkspacePath('C:/tree-a');await s.workspace.openWorkspacePath('C:/tree-b',true);s.appMode='workspace';s.sidebarVisible=true;s.sidebarPanel='files'
 })
 await toolbar().waitFor();assert.deepEqual(await toolbar().getByRole('button').evaluateAll(buttons=>buttons.map(b=>b.getAttribute('aria-label'))),['全部展开','全部收起','新建','定位当前文件','刷新目录树'])
 assert.equal(await toolbar().getByTitle('显示/隐藏被忽略的文件').count(),0);assert.equal(await toolbar().getByTitle('新建文件',{exact:true}).count(),0);assert.equal(await toolbar().getByTitle('隐藏侧边栏').count(),0)
 for(const width of [190,420]){await act(()=>{});await page.evaluate(width=>document.querySelector('#app').__vue_app__._instance.setupState.sidebarWidth=width,width);const box=await toolbar().boundingBox(),head=await page.locator('.panelhead').boundingBox();assert.ok(box.x>=head.x&&box.x+box.width<=head.x+head.width);assert.equal(await toolbar().locator('svg').count(),5)}
 await toolbar().getByRole('button',{name:'新建',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('menu',{name:'新建',exact:true}).waitFor();assert.deepEqual(await page.getByRole('menu',{name:'新建',exact:true}).getByRole('menuitem').allTextContents(),['新建文件','新建文件夹']);await page.keyboard.press('Escape')
 pass('五个工具按顺序、移除冗余按钮、统一SVG、190/420px标题布局、键盘新建菜单')
 await toolbar().getByRole('button',{name:'全部展开',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#app').__vue_app__._instance.setupState.workspace.expanding)
 assert.ok(await act(()=>window.fixture.reads.includes('C:/tree-b/pkg/deep')));await toolbar().getByRole('button',{name:'全部收起',exact:true}).click();assert.equal(await tree().locator('.treenode').count(),2)
 await act(()=>{const s=document.querySelector('#app').__vue_app__._instance.setupState;s.manager.openFile(window.fixture.open(window.fixture.target))});await setMarkdownMode(page,'源码');await toolbar().getByRole('button',{name:'全部收起',exact:true}).click()
 const count=await page.getByRole('tab').count(),text=await raw();await toolbar().getByRole('button',{name:'定位当前文件',exact:true}).click();await tree().locator('.treenode.active').waitFor();assert.equal(await page.getByRole('tab').count(),count);assert.equal(await raw(),text)
 assert.equal(await tree().locator('.treenode.active').getAttribute('title'),'很长的中文 folder name 当前文件.md\nC:/tree-b/pkg/deep/很长的中文 folder name 当前文件.md')
 const active=await tree().locator('.treenode.active').boundingBox(),bounds=await tree().boundingBox();assert.ok(active.y>=bounds.y&&active.y+active.height<=bounds.y+bounds.height)
 pass('全部展开真实多级加载/全部收起仅根节点、多工作区当前文件定位/滚动/悬停，无新标签或文本变化')
 await tree().evaluate(el=>el.scrollTop=el.scrollHeight);await page.waitForFunction(()=>[...document.querySelectorAll('.workspace-tree-container .label')].some(el=>el.textContent==='file-119.cmd'))
 assert.equal(await page.locator('.files-body').evaluate(el=>el.scrollHeight>el.clientHeight),false)
 for(const height of [1300,400]){await page.setViewportSize({width:1200,height});await tree().evaluate(el=>el.scrollTop=el.scrollHeight);await page.waitForTimeout(40);const layout=await tree().evaluate(el=>({height:el.clientHeight,last:[...el.querySelectorAll('.treenode')].at(-1).getBoundingClientRect().bottom,bottom:el.getBoundingClientRect().bottom,rows:el.querySelectorAll('.treenode').length}));assert.ok(layout.last<=layout.bottom+1);assert.ok(layout.rows>=Math.min(30,Math.floor(layout.height/26)))}
 await page.setViewportSize({width:1200,height:780});pass('360+节点共享全高度滚动、最后节点、增减窗口高度无空白/双滚动条')
 await toolbar().getByRole('button',{name:'新建',exact:true}).click();await page.getByRole('menuitem',{name:'新建文件',exact:true}).click();await page.getByRole('dialog',{name:'工作区文件操作'}).getByRole('textbox').fill('新建 文件.cmd');await page.getByRole('button',{name:'创建',exact:true}).click();await page.getByRole('tab',{name:'新建 文件.cmd',exact:true}).waitFor()
 await toolbar().getByRole('button',{name:'新建',exact:true}).click();await page.getByRole('menuitem',{name:'新建文件夹',exact:true}).click();await page.getByRole('dialog',{name:'工作区文件操作'}).getByRole('textbox').fill('新建 文件夹');await page.getByRole('button',{name:'创建',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#app').__vue_app__._instance.setupState.workspace.roots[1].entries.some(node=>node.name==='新建 文件夹'))
 await toolbar().getByRole('button',{name:'刷新目录树',exact:true}).click();await page.waitForFunction(()=>window.fixture.reads.includes('C:/tree-b'))
 pass('新建菜单复用真实控制器和对话框创建文件/文件夹、刷新（显式内存gateway）')
 await act(()=>{const s=document.querySelector('#app').__vue_app__._instance.setupState;window.fixture.md=s.manager.openFile(window.fixture.open(window.fixture.target));s.sidebarVisible=false})
 await setMarkdownMode(page,'源码');await act(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager,line=m.getState(m.activeId).doc.line(3);m.dispatch(m.activeId,{changes:{from:line.from,to:line.from+3,insert:'OLD'},annotations:window.fixture.isolateHistory.of('full')});m.dispatch(m.activeId,{changes:{from:line.from,insert:'new line\n'},annotations:window.fixture.isolateHistory.of('full')})})
 assert.deepEqual(await marks(),[{line:3,kind:'inserted'},{line:4,kind:'modified'}]);await page.locator('.cm-change-inserted').waitFor();await page.locator('.cm-change-modified').waitFor()
 for(const color of ['light','dark']){await theme(color);for(const mode of ['源码','即时排版']){await setMarkdownMode(page,mode);assert.equal(await editor().locator('.cm-line').count()>0,true);const geom=await page.locator('.main-pane .cm-change-modified').evaluate(el=>({width:el.getBoundingClientRect().width,color:getComputedStyle(el).backgroundColor}));assert.equal(geom.width,3);assert.notEqual(geom.color,'rgba(0, 0, 0, 0)');assert.equal(await page.locator('.main-pane .cm-gutters').locator('.cm-gutter').first().evaluate(el=>el.classList.contains('cm-change-gutter')),true);await page.screenshot({path:`${output}/${color}-${mode}.png`})}}
 await viewCommand(page,'编辑器分栏');await page.locator('.secondary-pane .cm-content').waitFor();const shared=await act(()=>{const s=document.querySelector('#app').__vue_app__._instance.setupState,m=s.manager,v=window.fixture.EditorView.findFromDOM(document.querySelector('.secondary-pane .cm-editor'));return [window.fixture.changedLines(m.getState(m.activeId)),window.fixture.changedLines(v.state)]});assert.deepEqual(shared[0],shared[1]);assert.equal(await page.locator('.secondary-pane .cm-change-inserted').count(),1);await viewCommand(page,'编辑器分栏')
 await editor().press('Control+z');assert.deepEqual(await marks(),[{line:3,kind:'modified'}]);await editor().press('Control+z');assert.deepEqual(await marks(),[]);await editor().press('Control+y');await editor().press('Control+y');assert.deepEqual(await marks(),[{line:3,kind:'inserted'},{line:4,kind:'modified'}])
 pass('原行橙色/新行绿色3px真gutter、偏移/撤销重做、明暗/Live/Source、双Pane一致')
 await act(async()=>{const s=document.querySelector('#app').__vue_app__._instance.setupState;await s.files.save(s.manager.activeId)});assert.deepEqual(await marks(),[]);assert.equal(await page.locator('.cm-change-modified,.cm-change-inserted').count(),0)
 await act(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;m.dispatch(m.activeId,{changes:{from:0,insert:'X'}});window.fixture.failSave=true})
 await act(async()=>{const s=document.querySelector('#app').__vue_app__._instance.setupState;await s.files.save(s.manager.activeId)});assert.deepEqual(await marks(),[{line:1,kind:'modified'}])
 await act(()=>{const s=document.querySelector('#app').__vue_app__._instance.setupState;window.fixture.failSave=false;window.fixture.auto=new window.fixture.AutoSaveController(s.manager,s.files);window.fixture.auto.configure(true,500)})
 await page.waitForFunction(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;return !m.activeDocument.dirty});assert.deepEqual(await marks(),[]);await act(()=>window.fixture.auto.dispose());pass('手动/自动保存成功更新基线、保存失败保留标记（控制gateway）')
 await act(()=>{const s=document.querySelector('#app').__vue_app__._instance.setupState;for(let i=0;i<40;i++)s.manager.createUntitled()});const tabs=page.locator('.main-pane .tabs');await page.waitForFunction(()=>document.querySelector('.main-pane .tabs').scrollLeft>0)
 assert.equal(await tabs.evaluate(el=>el.scrollWidth>el.clientWidth),true);assert.equal(await tabs.evaluate(el=>getComputedStyle(el,'::-webkit-scrollbar').display),'none')
 await tabs.evaluate(el=>el.scrollLeft=0);const tabbox=await tabs.boundingBox();await page.mouse.move(tabbox.x+tabbox.width/2,tabbox.y+tabbox.height/2);await page.mouse.wheel(0,140);await page.waitForFunction(()=>document.querySelector('.main-pane .tabs').scrollLeft>0);const left=await tabs.evaluate(el=>el.scrollLeft);await page.mouse.wheel(120,0);await page.waitForFunction(left=>document.querySelector('.main-pane .tabs').scrollLeft>left,left)
 await page.keyboard.press('Control+n');await page.waitForTimeout(30);const current=await tabs.locator('.tab.active').boundingBox(),tabBounds=await tabs.boundingBox();assert.ok(current.x>=tabBounds.x&&current.x+current.width<=tabBounds.x+tabBounds.width+1);await page.screenshot({path:`${output}/hidden-tab-scrollbar.png`});pass('40+标签横向滚动但无滚动条、纵向滚轮/横向滚轮和活动标签自动可见')
 await act(()=>{const s=document.querySelector('#app').__vue_app__._instance.setupState;s.sidebarVisible=true;s.manager.openFile({...window.fixture.open('C:/outside.txt'),token:'outside'})});await toolbar().getByRole('button',{name:'定位当前文件',exact:true}).click();await page.getByText('当前文件不在工作区内。',{exact:true}).waitFor()
 await act(()=>{const s=document.querySelector('#app').__vue_app__._instance.setupState;s.manager.select(window.fixture.md);window.fixture.dirs.set('C:/tree-b/pkg/deep',[])});await toolbar().getByRole('button',{name:'定位当前文件',exact:true}).click();await page.getByText(/无法定位当前文件/).waitFor();pass('工作区外与磁盘fixture删除后的定位给出轻量提示')
 assert.deepEqual(errors,[]);console.log(`PASS ${results.length} workspace/editor UX groups; explicit gateway providers, no desktop claim`)
}catch(error){results.push({result:'FAIL',error:String(error)});await page.screenshot({path:`${output}/failure.png`});throw error}
finally{await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));await browser.close()}
