import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { startRegressionServer } from './regression-server.mjs'
const { chromium } = await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const output = 'test-results/outline-docking'
fs.mkdirSync(output, { recursive: true })
const source = Array.from({length:6},(_,i)=>`${'#'.repeat(i+1)} ${['书写与项目导航','自动停靠与布局','保留当前章节与折叠','键盘操作与宽度','同一文档多个 Pane','长标题示例：自动适应可用空间并以省略号显示，不挤压正文'][i]}\n\n`+Array.from({length:18},(_,j)=>`第 ${i+1} 节 · 段落 ${j+1}。大纲跟随当前活动编辑区域，保留光标、选区和撤销记录。`).join('\n\n')).join('\n\n')
fs.writeFileSync(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import {mockIPC,mockWindows} from '@tauri-apps/api/mocks';import {createApp} from 'vue';
import {undoDepth,redoDepth} from '@codemirror/commands';import {TextSelection} from 'prosemirror-state';
import App from '/src/App.vue';import '/src/styles/reset.css';import '/src/styles/variables.css';import '/src/styles/main.css';
const root='C:/Markumo-writing';const entries=['writing.md','notes.md','src'].map((name,i)=>({id:name,name,path:root+'/'+name,relative_path:name,is_directory:i===2,is_symlink:false,is_read_only:false,size:0,mtime:null,has_children:i===2}));
window.isTauri=true;mockWindows('main');const saved=JSON.parse(localStorage.getItem('docking-settings')||'{}');const writes=[];
mockIPC(async(command,args)=>{
 if(command==='plugin:event|listen')return args.handler;
 if(command==='load_editor_settings')return {theme:'light',showOutline:true,outlineWidth:240,externalFileMonitoring:false,autoCheckUpdates:false,...saved};
 if(command==='save_editor_settings'){writes.push(args.settings);localStorage.setItem('docking-settings',JSON.stringify(args.settings));return}
 if(command==='initialize_launch')return {kind:'app',ownsSession:true,files:{files:[],errors:[]},roots:[{root_path:root,name:'Markumo-writing',entries}],activePath:null,layout:{mode:'single',sidebarVisible:false,sidebarWidth:254},warnings:[]};
 if(command==='file_preferences')return {recent:[],layout:{mode:'single',sidebarVisible:false}};
 if(command==='get_recent_workspaces'||command==='read_directory'||command==='find_workspace_files')return [];
 if(command==='drain_pending')return {files:[],errors:[]};
 if(command==='update_runtime')return {version:'1.0.5',platform:'windows',installSupported:false};
 if(command==='recovery_list')return {records:[],warnings:[]};
 return null;
});
const app=createApp(App);app.mount('#app');window.s=app._instance.setupState;
window.f={writes,TextSelection,source:${JSON.stringify(source)},open(text=${JSON.stringify(source)},name='writing.md'){
 return window.s.manager.openFile({token:name,path:root+'/'+name,name,text,encoding:'UTF-8',bom:false,eol:'LF',version:'v1',readOnly:false});
},snapshot(){const m=window.s.manager,id=m.activeId,state=m.getState(id);return {text:m.getText(id),undo:undoDepth(state),redo:redoDepth(state),dirty:m.activeDocument.dirty}},
 selection(){const m=window.s.manager;return m.activeLiveEditor?.selection||m.activeEditorView?.state.selection.toJSON()},
 remember(){const m=window.s.manager;window.outlineNode=document.querySelector('.outline-container');window.editorNodes=m.layout.getAllLeafIds().map(pane=>m.paneView(pane)||m.liveViews.get(pane)?.editor)},
 same(){const m=window.s.manager;return {outline:window.outlineNode===document.querySelector('.outline-container'),editors:window.editorNodes.every((view,i)=>view===(m.paneView(m.layout.getAllLeafIds()[i])||m.liveViews.get(m.layout.getAllLeafIds()[i])?.editor))}}
};
`)
const server = await startRegressionServer(), port=server.httpServer.address().port
let browser,page
const passed=[],errors=[]
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.MARKUMO_CHROME || (fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined)})
  page=await browser.newPage({viewport:{width:1600,height:900}})
  page.on('pageerror',error=>errors.push(error.message))
  await page.emulateMedia({reducedMotion:'reduce'})
  const start=async()=>{await page.goto(`http://127.0.0.1:${port}/${output}/index.html`);await page.waitForFunction(()=>window.s?.settingsReady&&!window.s.startupLoading);await page.evaluate(()=>window.f.open());await page.waitForSelector('.md-prose');await page.waitForFunction(()=>document.querySelectorAll('.outline-item').length===6)}
  const test=async(name,run)=>{await run();passed.push(name);console.log('PASS '+name)}
  const position=async side=>{
    await page.waitForFunction(side=>{const root=document.querySelector('.editor-container'),aside=root?.querySelector('.outline-sidebar'),main=root?.querySelector('.editor-main');if(!aside||!main||!aside.getClientRects().length)return false;const a=aside.getBoundingClientRect(),m=main.getBoundingClientRect();return root.dataset.outlinePosition===side&&(side==='left'?a.right<=m.left+1:a.left>=m.right-1)},side)
    assert.equal(await page.locator('.outline-container').count(),1)
  }
  const snapshot=()=>page.evaluate(()=>window.f.snapshot())
  const width=()=>page.locator('.outline-sidebar').evaluate(el=>Math.round(el.getBoundingClientRect().width))
  const screenshot=name=>page.screenshot({path:`${output}/${name}.png`,animations:'disabled'})
  await start()
  await test('single-file mode has exactly one left outline, with H1–H6 and no workspace content panel',async()=>{
    await position('left');assert.equal(await page.locator('.sidebar-wrapper').count(),0)
    assert.deepEqual(await page.locator('.outline-item').evaluateAll(items=>items.map(el=>Number(el.getAttribute('aria-level')))),[1,2,3,4,5,6])
    await page.evaluate(()=>window.f.remember());await screenshot('single-left')
    await page.evaluate(()=>window.s.toggleSidebar());await position('right')
    assert.equal(await page.evaluate(()=>window.s.appMode),'workspace')
    await page.evaluate(()=>window.s.setMode('single'));await position('left')
  })
  await test('workspace files/search move the same outline instance right, closing them returns it left without changing folds or document history',async()=>{
    await page.getByRole('button',{name:'折叠标题',exact:true}).nth(1).click()
    const labels=await page.locator('.outline-label').allTextContents(),before=await snapshot(),selection=await page.evaluate(()=>window.f.selection())
    await page.evaluate(()=>window.s.setMode('workspace'));await position('right')
    assert.equal(await page.locator('.workspace-tree-container').count(),1);await screenshot('workspace-tree-right')
    assert.deepEqual(await page.evaluate(()=>window.f.same()),{outline:true,editors:true})
    assert.deepEqual(await page.locator('.outline-label').allTextContents(),labels)
    await page.getByTitle('文件资源管理器',{exact:true}).click();await position('left');await screenshot('workspace-collapsed-left')
    await page.getByTitle('工作区全文搜索 (Ctrl+Shift+F)',{exact:true}).click();await position('right');await screenshot('workspace-search-right')
    await page.getByTitle('工作区全文搜索 (Ctrl+Shift+F)',{exact:true}).click();await position('left')
    assert.deepEqual(await page.evaluate(()=>window.f.same()),{outline:true,editors:true});assert.deepEqual(await snapshot(),before)
    assert.deepEqual(await page.evaluate(()=>window.f.selection()),selection)
    await page.getByRole('button',{name:'全部展开大纲'}).click();assert.equal(await page.locator('.outline-item').count(),6)
  })
  await test('rail, toolbar, view command and close button share one persistent preference without altering sidebar state',async()=>{
    const sidebar=await page.evaluate(()=>[window.s.sidebarPanel,window.s.sidebarVisible])
    await page.getByTitle('文档大纲',{exact:true}).click();await page.locator('.outline-sidebar').waitFor({state:'hidden'})
    assert.deepEqual(await page.evaluate(()=>[window.s.sidebarPanel,window.s.sidebarVisible]),sidebar)
    await page.evaluate(()=>window.s.setMode('workspace'));assert.equal(await page.evaluate(()=>window.s.showOutline),false)
    await page.evaluate(()=>window.s.executeCommand('workspace-search'));assert.equal(await page.locator('.outline-sidebar').isVisible(),false)
    await page.evaluate(()=>window.s.executeCommand('toggle-outline'));await position('right')
    await page.locator('.md-toolbar-outline').click();await page.locator('.outline-sidebar').waitFor({state:'hidden'})
    await page.getByRole('menuitem',{name:'视图',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:'显示文档大纲',exact:true}).click();await position('right')
    await page.getByRole('button',{name:'关闭大纲',exact:true}).click();await page.locator('.outline-sidebar').waitFor({state:'hidden'})
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('docking-settings')).showOutline===false)
    await page.evaluate(()=>window.s.executeCommand('toggle-outline'));await position('right')
  })
  await test('left/right drag updates immediately but saves only on release; one preferred width survives reload and temporary constraints',async()=>{
    await page.evaluate(()=>window.s.setMode('single'));await position('left')
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('docking-settings')).outlineWidth===240)
    let handle=page.getByRole('separator',{name:'调整大纲宽度'}),box=await handle.boundingBox()
    await page.mouse.move(box.x+2,box.y+100);await page.mouse.down();await page.mouse.move(box.x+82,box.y+100,{steps:6})
    assert.equal(await width(),320);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('docking-settings')).outlineWidth),240)
    await page.mouse.up();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('docking-settings')).outlineWidth===320)
    await page.evaluate(()=>window.s.setMode('workspace'));await position('right');box=await handle.boundingBox()
    await page.mouse.move(box.x+2,box.y+100);await page.mouse.down();await page.mouse.move(box.x-38,box.y+100,{steps:6});await page.mouse.up()
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('docking-settings')).outlineWidth===360)
    await start();await position('left');assert.equal(await width(),360)
    await page.setViewportSize({width:420,height:800});await page.locator('.outline-sidebar').waitFor({state:'hidden'});await screenshot('narrow-window')
    assert.equal(await page.evaluate(()=>window.s.showOutline),true)
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('docking-settings')).outlineWidth),360)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    await page.setViewportSize({width:1600,height:900});await position('left');assert.equal(await width(),360)
    await handle.focus();await page.keyboard.press('ArrowLeft');assert.equal(await width(),350)
    await handle.dblclick();assert.equal(await width(),240)
    assert.equal(await page.evaluate(()=>Object.hasOwn(JSON.parse(localStorage.getItem('docking-settings')),'outlinePosition')),false)
  })
  await test('Live/Source/Split keep one outline; caret and scroll highlight the current chapter without edits',async()=>{
    const before=await snapshot()
    for(const mode of ['source','split','live']){
      await page.evaluate(mode=>window.s.manager.setMarkdownMode(window.s.activeDocId,mode,'main'),mode)
      await position('left');assert.equal(await page.locator('.outline-container').count(),1)
      if(mode==='live')await page.waitForSelector('.md-prose');else await page.waitForSelector('.cm-editor')
    }
    await page.evaluate(()=>{const m=window.s.manager,live=m.activeLiveEditor,source=m.getText(m.activeId),at=source.indexOf('### 保留');live.view.dispatch(live.view.state.tr.setSelection(window.f.TextSelection.create(live.view.state.doc,live.bridge.documentPosition(at)+1)))})
    await page.waitForFunction(()=>document.querySelector('.outline-item.active .outline-label')?.textContent==='保留当前章节与折叠')
    await page.locator('.markdown-live').evaluate(root=>root.scrollTop+=root.querySelector('h5').getBoundingClientRect().top-root.getBoundingClientRect().top-22)
    await page.waitForTimeout(150);await page.locator('.markdown-live').evaluate(root=>root.dispatchEvent(new Event('scroll')))
    await page.waitForFunction(()=>document.querySelector('.outline-item.active .outline-label')?.textContent==='同一文档多个 Pane')
    assert.deepEqual(await snapshot(),before)
  })
  await test('all fold controls and keyboard tree navigation retain the active chapter and ellipsize long titles in both themes',async()=>{
    await page.getByRole('button',{name:'全部收起大纲'}).click();assert.equal(await page.locator('.outline-item').count(),1)
    await page.locator('.outline-item').first().focus();await page.keyboard.press('ArrowRight')
    assert.equal(await page.locator('.outline-item').count(),2)
    await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowRight')
    assert.equal(await page.locator('.outline-item').count(),3)
    await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('.outline-item').count(),2)
    await page.getByRole('button',{name:'全部展开大纲'}).click();assert.equal(await page.locator('.outline-item').count(),6)
    await page.locator('.outline-item').first().focus();await page.keyboard.press('End')
    assert.equal(await page.locator('.outline-item').last().evaluate(el=>el===document.activeElement),true)
    await page.keyboard.press('Home');assert.equal(await page.locator('.outline-item').first().evaluate(el=>el===document.activeElement),true)
    assert.equal(await page.locator('.outline-label').last().evaluate(el=>el.scrollWidth>el.clientWidth&&getComputedStyle(el).textOverflow==='ellipsis'),true)
    await page.evaluate(()=>{window.s.theme='dark';window.s.setMode('workspace')});await position('right')
    await page.waitForTimeout(150)
    const contrast=await page.locator('.outline-item.active').evaluate(el=>{
      const canvas=document.createElement('canvas');canvas.width=2;canvas.height=1;const ctx=canvas.getContext('2d')
      ctx.fillStyle=getComputedStyle(el).backgroundColor;ctx.fillRect(0,0,1,1)
      ctx.fillStyle=getComputedStyle(el.querySelector('.outline-label')).color;ctx.fillRect(1,0,1,1)
      const luminance=offset=>{const c=ctx.getImageData(offset,0,1,1).data;return [.2126,.7152,.0722].reduce((sum,weight,i)=>{const value=c[i]/255;return sum+weight*(value<=.04045?value/12.92:((value+.055)/1.055)**2.4)},0)}
      const a=luminance(0),b=luminance(1);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)
    });assert.ok(contrast>=4.5)
    await screenshot('workspace-dark')
    await page.evaluate(()=>{window.s.theme='light';window.s.setMode('single')});await position('left')
  })
  await test('multiple panes share the singleton outline and navigation targets only the active pane',async()=>{
    await page.evaluate(()=>{const m=window.s.manager;m.setMarkdownMode(m.activeId,'source','main');window.other=m.splitPane('right','main',m.activeId)})
    await page.waitForFunction(()=>document.querySelectorAll('.cm-scroller').length===2);await position('left')
    await page.evaluate(()=>window.f.remember());const before=await snapshot()
    await page.locator('.outline-label').filter({hasText:/^自动停靠与布局$/}).click()
    const result=await page.evaluate(()=>{const m=window.s.manager;return {main:m.paneView('main').state.selection.main.head,other:m.paneView(window.other).state.selection.main.head,expected:m.getText(m.activeId).indexOf('## 自动')}})
    assert.equal(result.other,result.expected);assert.notEqual(result.main,result.other);assert.deepEqual(await snapshot(),before)
    await page.evaluate(()=>window.s.setMode('workspace'));await position('right');assert.deepEqual(await page.evaluate(()=>window.f.same()),{outline:true,editors:true});await screenshot('multi-pane')
    await page.evaluate(()=>{const layout=window.s.manager.layout;layout.resizeSplit(layout.root.id,.8)})
    await page.locator('.outline-sidebar').waitFor({state:'hidden'})
    await page.evaluate(()=>{const layout=window.s.manager.layout;layout.resizeSplit(layout.root.id,.5)});await position('right')
    await page.setViewportSize({width:1000,height:800});await page.evaluate(()=>window.s.sidebarWidth=420)
    await page.locator('.outline-sidebar').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.s.showOutline),true)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    await page.setViewportSize({width:1600,height:900});await position('right')
  })
  await test('focus only masks visibility, restores the same instance, and document changes update headings or code symbols',async()=>{
    await page.evaluate(()=>window.s.manager.mergeAllPanes());await position('right');await page.evaluate(()=>window.f.remember())
    const before=await snapshot();await page.keyboard.press('F8');await page.waitForFunction(()=>window.s.focusMode)
    assert.equal(await page.evaluate(()=>window.s.showOutline),true);await page.locator('.outline-sidebar').waitFor({state:'hidden'})
    await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('docking-settings')).showOutline),true)
    await page.keyboard.press('Escape');await position('right');assert.deepEqual(await snapshot(),before)
    assert.deepEqual(await page.evaluate(()=>window.f.same()),{outline:true,editors:true})
    await page.evaluate(()=>window.f.open('# 不同文档\n\n## 新章节','notes.md'))
    await page.waitForFunction(()=>document.querySelector('.outline-label')?.textContent==='不同文档')
    await page.evaluate(()=>window.f.open('export class Docking { run() { return 1 } }','docking.ts'))
    await page.waitForFunction(()=>document.querySelector('.outline-label')?.textContent==='Docking')
    assert.equal(await page.locator('.outline-container').count(),1)
  })
  assert.deepEqual(errors,[])
  fs.writeFileSync(`${output}/results.json`,JSON.stringify({passed,errors,browser:browser.version()},null,2))
  console.log(`PASS ${passed.length} automatic outline docking checks`)
} catch(error) {
  console.error('browser errors',errors)
  if(page){console.error(await page.evaluate(()=>({text:document.body.innerText.slice(0,1500),ready:window.s?.settingsReady,mode:window.s?.appMode,outline:window.s?.showOutline,html:document.querySelector('.editor-container')?.outerHTML.slice(-2200)})));await page.screenshot({path:`${output}/failure.png`})}
  throw error
} finally { await browser?.close(); await server.close() }
