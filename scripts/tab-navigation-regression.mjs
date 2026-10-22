import assert from 'node:assert/strict'
import fs from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createServer} from 'vite'
const {chromium}=await import(process.env.MARKUMO_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href:'playwright')
const output='test-results/tab-navigation'
fs.mkdirSync(output,{recursive:true})
fs.writeFileSync(`${output}/index.html`,'<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`,String.raw`
import {mockIPC,mockWindows} from '@tauri-apps/api/mocks';import {createApp} from 'vue';
import App from '/src/App.vue';import {TabGroup} from '/src/features/tabs/TabGroup.ts';import {tabLabels} from '/src/features/tabs/tabLabels.ts';import {pathCrumbs,navigationDirectory,navigationParent} from '/src/features/workspace/navigation.ts';
import '/src/styles/reset.css';import '/src/styles/variables.css';import '/src/styles/main.css';
const root='C:/项目/Markumo',otherRoot='D:/项目/Markumo',reads=[],writes=[];
const node=(path,is_directory=false,is_symlink=false)=>({id:path,name:path.split('/').pop(),path,relative_path:path.slice(root.length+1),is_directory,is_symlink,is_readonly:false,size:0,mtime:null,has_children:is_directory});
const directories={
 [root]:[node(root+'/src',true),node(root+'/tests',true),node(root+'/large',true),node(root+'/目录失败',true),node(root+'/说明.md')],
 [root+'/large']:Array.from({length:2200},(_,i)=>node(root+'/large/f'+String(i).padStart(4,'0')+'.ts')),
 [root+'/src']:[node(root+'/src/components',true),node(root+'/src/utils',true)],
 [root+'/src/components']:[node(root+'/src/components/index.ts'),node(root+'/src/components/中文.ts'),node(root+'/src/components/子目录',true),node(root+'/src/components/链接',true,true),node('C:/禁止/escape.ts'),node(root+'/src/components/../escape.ts')],
 [root+'/src/components/子目录']:[node(root+'/src/components/子目录/child.ts')],
 [root+'/src/utils']:[node(root+'/src/utils/index.ts')],
 [root+'/tests']:[node(root+'/tests/index.ts')],
 [otherRoot]:[node(otherRoot+'/src',true)],
 [otherRoot+'/src/components']:[node(otherRoot+'/src/components/index.ts')]
};
const source='class User {\n  loadData() {\n    function nested() { return 1; }\n    return nested();\n  }\n}\n'+Array.from({length:450},(_,i)=>'// 第 '+i+' 行').join('\n');
const file=(path,text=source)=>({token:path,path,name:path.replace(/\\/g,'/').split('/').pop(),text,kind:'text',encoding:'UTF-8',bom:false,eol:'LF',readOnly:false,version:'v1'});
window.isTauri=true;mockWindows('main');
mockIPC(async(command,args)=>{
 if(command==='plugin:event|listen')return args.handler;
 if(command==='load_editor_settings')return {theme:'dark',showOutline:false,externalFileMonitoring:false,autoCheckUpdates:false};
 if(command==='save_editor_settings')return;
 if(command==='initialize_launch')return {kind:'app',ownsSession:true,files:{files:[],errors:[]},roots:[{root_path:root,name:'Markumo',entries:directories[root]},{root_path:otherRoot,name:'Markumo',entries:directories[otherRoot]}],activePath:null,layout:{mode:'workspace',sidebarVisible:false,sidebarWidth:254},warnings:[]};
 if(command==='file_preferences')return {recent:[],layout:{mode:'workspace',sidebarVisible:false}};
 if(command==='read_directory'){reads.push(args.path);if(args.path===root+'/目录失败')throw Error('权限不足');if(window.delayDirectory)await new Promise(resolve=>window.resolveDirectory=resolve);return directories[args.path]||[]}
 if(command==='open_workspace_file')return file(args.path);
 if(command==='workspace_file_visible')return true;
 if(command==='get_recent_workspaces'||command==='find_workspace_files')return [];
 if(command==='drain_pending')return {files:[],errors:[]};
 if(command==='update_runtime')return {version:'1.0.5',platform:'windows',installSupported:false};
 if(command==='recovery_list')return {records:[],warnings:[]};
 if(command==='recovery_save'){const input=args.input;return {record:{id:input.id||input.path||input.name,name:input.name,path:input.path,updatedAt:Date.now(),charCount:input.text.length,sizeBytes:input.text.length,panes:input.panes,mode:input.mode,diskExists:true,diskChanged:false},warnings:[],version:'fixture-v1'}};
 if(command==='save_file'){writes.push(args);return {...file(args.token),text:undefined,version:'v2'}};
 return null;
});
const app=createApp(App);app.mount('#app');window.s=app._instance.setupState;
window.f={root,otherRoot,reads,writes,source,file,TabGroup,tabLabels,pathCrumbs,navigationDirectory,navigationParent,
 open(path,text=source,preview=false){return window.s.manager.openFile(file(path,text),preview)},
 snapshot(pane='main'){const m=window.s.manager,v=m.paneView(pane);return {id:m.paneGroup(pane).activeId,selection:v?.state.selection.toJSON(),top:v?.scrollDOM.scrollTop,left:v?.scrollDOM.scrollLeft}},
 clear(){const m=window.s.manager;for(const pane of [...m.layout.getAllLeafIds()])for(const t of [...m.paneGroup(pane).tabs])m.close(t.documentId,true,pane)}
};
`)
const server=await createServer({optimizeDeps:{entries:[`${output}/index.html`],include:['@tauri-apps/api/mocks']},server:{host:'127.0.0.1',port:1469,strictPort:true,hmr:false,watch:null}})
await server.listen()
const port=server.httpServer.address().port
let browser,page
const results=[],errors=[],metrics={}
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.MARKUMO_CHROME})
 page=await browser.newPage({viewport:{width:1450,height:850},reducedMotion:'reduce'})
 page.on('pageerror',error=>errors.push(error.message))
 await page.goto(`http://127.0.0.1:${port}/${output}/index.html`)
 await page.waitForFunction(()=>window.s?.settingsReady&&!window.s.startupLoading)
 const test=async(name,run)=>{await run();results.push(name);console.log('PASS '+name)}
 const main=()=>page.locator('[data-pane-id="main"]')
 const crumbs=()=>page.locator('.breadcrumb-trail, .breadcrumb')
 const popup=()=>page.locator('.navigation-popup')
 const open=async(relative,text,preview=false)=>{const id=await page.evaluate(({relative,text,preview})=>window.f.open(window.f.root+'/'+relative,text,preview),{relative,text,preview});await page.waitForFunction(id=>window.s.manager.activeId===id&&window.s.manager.metadata(id)?.languageStatus==='ready',id);return id}
 const menu=async()=>{await main().getByRole('button',{name:'显示已打开文件',exact:true}).click();await popup().getByRole('combobox').waitFor()}
 const select=async(text)=>{await menu();await popup().getByRole('combobox').fill(text);await popup().getByRole('option').first().click();await popup().waitFor({state:'hidden'})}
 const screenshot=name=>page.screenshot({path:`${output}/${name}.png`,animations:'disabled'})
 await test('shortest unique labels cover three names, nested collisions, roots, Windows/UNC and pathless documents',async()=>{
  const labels=await page.evaluate(()=>{
   const {root,otherRoot,tabLabels,pathCrumbs}=window.f
   const docs=[{id:'a',name:'index.ts',path:root+'/src/components/index.ts'},{id:'b',name:'index.ts',path:root+'/src/utils/index.ts'},{id:'c',name:'index.ts',path:root+'/tests/index.ts'}]
   const simple=[...tabLabels(docs).values()];docs.push({id:'d',name:'index.ts',path:otherRoot+'/src/components/index.ts'})
   const roots=window.s.workspace.roots
   return {simple,roots:[...tabLabels(docs).values()],windows:pathCrumbs('C:\\项目\\Markumo\\src\\components\\index.ts',roots),outside:pathCrumbs('C:/项目/Markumo-other/a.ts',roots),traversal:pathCrumbs(root+'/src/../a.ts',roots),unc:[...tabLabels([{id:'u',name:'a.ts',path:'\\\\server\\one\\a.ts'},{id:'v',name:'a.ts',path:'\\\\server\\two\\a.ts'}]).values()],drafts:[...tabLabels([{id:'u',name:'draft',path:''},{id:'v',name:'draft',path:''}]).values()]}
  })
  assert.deepEqual(labels.simple,['components/index.ts','utils/index.ts','tests/index.ts'])
  assert.match(labels.roots[0],/^C:/);assert.match(labels.roots[3],/^D:/);assert.match(labels.windows[0].name,/^C:/);assert.equal(labels.windows.at(-1).name,'index.ts')
  assert.deepEqual(labels.outside,[]);assert.deepEqual(labels.traversal,[]);assert.deepEqual(labels.unc,['one/a.ts','two/a.ts']);assert.equal(new Set(labels.drafts).size,2)
  assert.deepEqual(await page.evaluate(()=>[window.f.navigationParent('C:/folder','C:/'),window.f.navigationParent('/folder','/'),window.f.pathCrumbs('C:/file.ts',[{name:'C',rootPath:'C:/',entries:[]}]).at(-1).name]),['C:/','/','file.ts'])
  await open('src/components/index.ts');await open('src/utils/index.ts');await open('tests/index.ts')
  assert.deepEqual(await main().locator('.filename').allTextContents(),labels.simple)
  await screenshot('same-name-tabs')
  await page.evaluate(()=>window.f.open(window.f.otherRoot+'/src/components/index.ts'))
  await page.waitForFunction(()=>document.querySelector('.filename')?.textContent.startsWith('C:'))
  assert.equal(await main().locator('.tab').last().getAttribute('title'),'D:/项目/Markumo/src/components/index.ts')
 })
 await test('preview replacement protects dirty buffers and double click pins',async()=>{
  await open('preview-a.ts',undefined,true);await open('preview-b.ts',undefined,true)
  assert.equal(await main().locator('.filename',{hasText:'preview-a.ts'}).count(),0)
  await main().locator('.tab.active').dblclick();assert.equal(await main().locator('.tab.active').evaluate(el=>el.classList.contains('pinned')),true)
  const id=await open('dirty-preview.ts',undefined,true)
  await main().locator('.cm-content').click();await page.keyboard.type('changed')
  await open('fresh-preview.ts',undefined,true)
  assert.equal(await page.evaluate(id=>window.s.manager.metadata(id)?.dirty,id),true)
  assert.equal(await main().locator('.filename',{hasText:'dirty-preview.ts'}).count(),1)
 })
 await test('100 tabs keep active visible, scroll horizontally, retain controls and stable dirty widths',async()=>{
  await page.evaluate(()=>{for(let i=0;i<100;i++)window.f.open(window.f.root+'/bulk/file-'+i+'.ts')})
  await page.waitForFunction(()=>document.querySelectorAll('.tab').length>=100)
  await page.waitForFunction(()=>{const a=document.querySelector('.tab.active').getBoundingClientRect(),b=document.querySelector('.tabs-scroll').getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1})
  const before=await main().locator('.tab.active').boundingBox()
  await page.evaluate(()=>window.s.manager.dispatch(window.s.manager.activeId,{changes:{from:0,insert:'// edit\n'}}))
  assert.equal(Math.round((await main().locator('.tab.active').boundingBox()).width),Math.round(before.width))
  await main().locator('.tabs-scroll').evaluate(el=>el.scrollLeft=0)
  await page.evaluate(()=>window.s.manager.notify());await page.waitForTimeout(80)
  assert.equal(await main().locator('.tabs-scroll').evaluate(el=>el.scrollLeft),0)
  await main().locator('.tabs-scroll').hover();await page.mouse.wheel(0,450);await page.waitForTimeout(80)
  assert.ok(await main().locator('.tabs-scroll').evaluate(el=>el.scrollLeft)>100)
  assert.ok(await main().getByRole('button',{name:'显示已打开文件',exact:true}).isVisible())
  await menu();await popup().getByRole('combobox').fill('file-99.ts');assert.equal(await popup().getByRole('option').count(),1);assert.equal(await popup().locator('.navigation-dirty.dirty').count(),1)
  await screenshot('dark-open-files');await page.keyboard.press('Escape')
  const timing=await page.evaluate(()=>{const start=performance.now();for(let i=0;i<100;i++)window.f.tabLabels(window.s.manager.openedDocuments);return performance.now()-start});metrics.labels100x=timing;assert.ok(timing<200)
 })
 await test('MRU is pane-local and distinct from positional next/previous; keyboard and menu use registry',async()=>{
  await select('src/utils/index.ts');const a=await page.evaluate(()=>window.s.manager.activeId)
  await select('tests/index.ts');const b=await page.evaluate(()=>window.s.manager.activeId)
  await page.keyboard.press('Control+Tab');await page.waitForFunction(a=>window.s.manager.activeId===a,a)
  await page.keyboard.press('Control+Tab');await page.waitForFunction(b=>window.s.manager.activeId===b,b)
  await page.evaluate(()=>window.s.executeCommand('next-tab'))
  const position=await page.evaluate(()=>{const g=window.s.manager.group;return g.tabs.findIndex(t=>t.documentId===g.activeId)})
  assert.ok(position>0)
  await page.evaluate(()=>window.s.executeCommand('previous-tab'));assert.equal(await page.evaluate(()=>window.s.manager.activeId),b)
  await page.evaluate(()=>window.s.executeCommand('show-open-tabs'));await popup().waitFor()
  await popup().getByRole('combobox').fill('file-87.ts');await page.keyboard.press('Enter');await page.waitForFunction(()=>window.s.manager.activeDocument.name==='file-87.ts')
 })
 await test('tab selection and scrolling restore on rapid switch; same active EditorView is retained',async()=>{
  await select('file-75.ts')
  await page.evaluate(()=>{const m=window.s.manager,v=m.activeEditorView;window.savedView=v;m.revealPosition(m.activeId,220,3);v.scrollDOM.scrollTop=2600})
  await page.waitForTimeout(120);const before=await page.evaluate(()=>window.f.snapshot())
  await select('file-76.ts');await select('file-75.ts');await page.waitForTimeout(120)
  const after=await page.evaluate(()=>window.f.snapshot());assert.deepEqual(after.selection,before.selection);assert.ok(Math.abs(after.top-before.top)<3,JSON.stringify({before,after}))
  assert.equal(await page.evaluate(()=>window.savedView===window.s.manager.activeEditorView),true)
  await main().locator('.tab.active').click();assert.equal(await page.evaluate(()=>window.savedView===window.s.manager.activeEditorView),true)
  await page.evaluate(()=>{const m=window.s.manager,ids=m.group.tabs.slice(-15).map(t=>t.documentId);for(const id of ids)m.select(id)})
  await page.waitForFunction(()=>document.querySelector('.tab.active').dataset.document===window.s.manager.activeId)
  await page.evaluate(()=>window.s.manager.activeEditorView.scrollDOM.scrollTop=3000)
  await page.waitForTimeout(120)
  await open('fresh-position.ts');await page.waitForTimeout(200)
  assert.equal(await page.evaluate(()=>window.s.manager.activeEditorView.scrollDOM.scrollTop),0)
  assert.equal(await page.evaluate(()=>window.s.manager.activeEditorView.state.selection.main.head),0)
  await page.evaluate(()=>{const m=window.s.manager;window.f.open(window.f.root+'/immediate-position.ts');m.revealPosition(m.activeId,220,3)})
  await page.waitForTimeout(200)
  assert.equal(await page.evaluate(()=>{const v=window.s.manager.activeEditorView,p=v.state.selection.main.head,r=v.coordsAtPos(p),b=v.scrollDOM.getBoundingClientRect();return v.state.doc.lineAt(p).number===220&&r.top>=b.top&&r.bottom<=b.bottom}),true)
 })
 await test('closing clean active and multiple tabs selects neighbors without phantom focus',async()=>{
  await select('file-80.ts');const id=await page.evaluate(()=>window.s.manager.activeId)
  await main().locator('.tab.active .tinyclose').click();assert.notEqual(await page.evaluate(()=>window.s.manager.activeId),id)
  for(let count=0;count<6;count++)await main().locator('.tab.active .tinyclose').click()
  assert.equal(await page.evaluate(()=>window.s.manager.activeEditorView.hasFocus),true)
  assert.equal(await page.evaluate(()=>window.s.manager.group.tabs.some(t=>t.documentId===window.s.manager.activeId)),true)
 })
 await test('actual pointer drag reorders tabs and retains tab identity',async()=>{
  await page.evaluate(()=>{window.f.clear();window.f.open(window.f.root+'/drag-a.ts');window.f.open(window.f.root+'/drag-b.ts');window.f.open(window.f.root+'/drag-c.ts')})
  const a=await main().locator('.tab').nth(0).boundingBox(),b=await main().locator('.tab').nth(1).boundingBox()
  await page.mouse.move(a.x+25,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width-6,b.y+b.height/2,{steps:12});await page.mouse.up()
  assert.deepEqual(await main().locator('.filename').allTextContents(),['drag-b.ts','drag-a.ts','drag-c.ts'])
 })
 await test('same file in two panes keeps separate positions and closing an inactive pane does not reset active view',async()=>{
  const other=await page.evaluate(()=>{const m=window.s.manager;return m.splitPane('right','main',m.activeId)})
  await page.waitForFunction(other=>window.s.manager.paneView(other),other)
  await page.evaluate(()=>{const m=window.s.manager;window.f.open(window.f.root+'/pane-only.ts');const last=m.activeId;m.select(m.group.recentDocumentIds.find(id=>id!==last));window.s.executeCommand('recent-tab')})
  assert.equal(await page.evaluate(()=>window.s.manager.activeDocument.name),'pane-only.ts')
  await page.evaluate(()=>{const m=window.s.manager;m.close(m.activeId,true);m.focusPane('main');m.focusPane(m.layout.getAllLeafIds().find(id=>id!=='main'))})
  await page.evaluate(()=>{const m=window.s.manager;m.revealPosition(m.activeId,100,2);m.activeEditorView.scrollDOM.scrollTop=1300;m.focusPane('main');m.revealPosition(m.activeId,250,2);m.activeEditorView.scrollDOM.scrollTop=3300;window.savedView=m.activeEditorView})
  await page.waitForTimeout(150);const before=await page.evaluate(()=>window.f.snapshot())
  await page.evaluate(other=>{const m=window.s.manager;m.close(m.paneGroup(other).activeId,true,other)},other)
  await page.waitForTimeout(120);assert.deepEqual(await page.evaluate(()=>window.f.snapshot()),before)
  assert.equal(await page.evaluate(()=>window.savedView===window.s.manager.activeEditorView),true)
 })
 await test('workspace breadcrumb opens authorized direct children on demand and supports keyboard, nested paths and errors',async()=>{
  await open('src/components/index.ts');await page.waitForFunction(()=>document.querySelectorAll('.crumb-directory').length===3)
  assert.deepEqual(await crumbs().locator('.crumb-directory').allTextContents(),['C:/项目/Markumo','src','components'])
  const count=await page.evaluate(()=>window.f.reads.length)
  await crumbs().getByRole('button',{name:'浏览目录 components',exact:true}).click()
  await popup().getByRole('option',{name:'中文.ts'}).waitFor()
  await page.keyboard.press('ArrowDown');assert.equal(await popup().getByRole('option', {selected:true}).count(),1);await page.keyboard.press('ArrowUp')
  assert.ok(await page.evaluate(()=>window.f.reads.length)>count)
  assert.equal(await popup().getByRole('option').count(),3)
  await screenshot('directory-menu')
  await popup().getByRole('combobox').fill('中文');await page.keyboard.press('Enter')
  await page.waitForFunction(()=>window.s.manager.activeDocument?.name==='中文.ts')
  await crumbs().getByRole('button',{name:'浏览目录 components',exact:true}).click();await popup().getByRole('option',{name:'子目录'}).click()
  await popup().getByRole('option',{name:'child.ts'}).waitFor();await popup().getByRole('button',{name:'上一级目录'}).focus();await page.keyboard.press('Enter')
  await popup().getByRole('option',{name:'中文.ts'}).waitFor()
  await popup().getByRole('button',{name:'在工作区文件树中定位当前文件'}).focus();await page.keyboard.press('Enter')
  await popup().waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.s.workspace.selectedTreePath),await page.evaluate(()=>window.s.manager.activeDocument.path))
  await open('large/f1900.ts');await crumbs().getByRole('button',{name:'浏览目录 large',exact:true}).click()
  await popup().getByRole('option').first().waitFor();await popup().getByRole('button',{name:'在工作区文件树中定位当前文件'}).click();await popup().waitFor({state:'hidden'})
  const located=page.locator('[data-tree-path="C:/项目/Markumo/large/f1900.ts"]')
  await located.waitFor();assert.ok(await located.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.closest('[role="tree"]').getBoundingClientRect();return a.top>=b.top&&a.bottom<=b.bottom}))
  await page.evaluate(()=>window.s.sidebarVisible=false)
  await open('目录失败/file.ts');await crumbs().getByRole('button',{name:'浏览目录 目录失败',exact:true}).click()
  await popup().getByRole('status').filter({hasText:'无法加载目录'}).waitFor();await screenshot('directory-error');await page.keyboard.press('Escape')
 })
 await test('stale directory requests, moved files and single-file mode cannot retain old workspace menus',async()=>{
  await open('src/components/index.ts')
  await page.evaluate(()=>window.delayDirectory=true)
  await crumbs().getByRole('button',{name:'浏览目录 components',exact:true}).click();await page.waitForFunction(()=>!!window.resolveDirectory)
  await page.evaluate(()=>{const m=window.s.manager;m.renamePath(m.activeDocument.path,window.f.root+'/src/utils/renamed.ts','renamed.ts');window.delayDirectory=false;window.resolveDirectory()})
  await popup().waitFor({state:'hidden'});assert.equal(await crumbs().locator('.crumb-file').innerText(),'renamed.ts')
  assert.deepEqual(await crumbs().locator('.crumb-directory').allTextContents(),['C:/项目/Markumo','src','utils'])
  await page.evaluate(()=>window.s.setMode('single'));assert.equal(await crumbs().locator('.crumb-directory').count(),0)
  assert.equal(await crumbs().locator('.crumb-file').innerText(),'renamed.ts')
  await page.evaluate(()=>window.s.setMode('workspace'))
 })
 await test('code symbol and Markdown heading breadcrumbs use actual outline ranges without recreating editors',async()=>{
  await page.evaluate(()=>window.s.sidebarVisible=false)
  await open('src/symbol.ts')
  await page.evaluate(()=>{const m=window.s.manager;m.revealPosition(m.activeId,3,20);window.savedView=m.activeEditorView})
  await page.waitForFunction(()=>[...document.querySelectorAll('.crumb-symbol')].some(el=>el.textContent==='nested()'))
  await crumbs().getByRole('button',{name:'nested()',exact:true}).click()
  assert.equal(await page.evaluate(()=>{const m=window.s.manager,v=m.activeEditorView,p=v.state.selection.main.head;return v.state.sliceDoc(p,p+6)}),'nested')
  assert.equal(await page.evaluate(()=>window.savedView===window.s.manager.activeEditorView),true)
  await screenshot('symbol-breadcrumb')
  await open('说明.md','# 一级\n\n正文\n\n## 二级\n\n正文')
  await page.evaluate(()=>{const m=window.s.manager;m.setMarkdownMode(m.activeId,'source');m.revealPosition(m.activeId,5,3)})
  await page.waitForFunction(()=>[...document.querySelectorAll('.crumb-symbol')].some(el=>el.textContent==='二级'))
  assert.deepEqual(await crumbs().locator('.crumb-symbol').allTextContents(),['一级','二级'])
  await crumbs().getByRole('button',{name:'二级',exact:true}).click();assert.equal(await page.evaluate(()=>window.s.manager.getMarkdownMode(window.s.manager.activeId)),'source')
 })
 await test('save metadata, moved paths and restored layouts retain labels, active tabs and preview state',async()=>{
  await open('save.ts');await page.evaluate(()=>{const m=window.s.manager;const snapshot=m.saveSnapshot(m.activeId);snapshot.complete({...window.f.file(window.f.root+'/src/saved.ts'),text:undefined})})
  await page.waitForFunction(()=>document.querySelector('.tab.active .filename')?.textContent==='saved.ts')
  await page.evaluate(()=>{const m=window.s.manager;window.layout=m.layout.serialize();m.restoreLayout(window.layout)})
  await page.waitForFunction(()=>window.s.manager.activeDocument?.name==='saved.ts'&&!!window.s.manager.activeEditorView)
  assert.equal(await main().locator('.tab.active .filename').innerText(),'saved.ts')
  assert.equal(await page.evaluate(()=>window.s.manager.group.recentDocumentIds[0]===window.s.manager.activeId),true)
 })
 await test('light/dark, narrow windows and multiple panes have bounded layouts and visible menu controls',async()=>{
  await page.evaluate(()=>{window.s.theme='light';window.s.sidebarVisible=false})
  await screenshot('light-breadcrumb')
  await page.evaluate(()=>window.s.manager.splitPane('right','main',window.s.manager.activeId))
  await page.waitForFunction(()=>document.querySelectorAll('.pane').length===2)
  await screenshot('multi-pane')
  await page.setViewportSize({width:620,height:700});await page.waitForTimeout(150)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth))
  assert.equal(await page.getByRole('button',{name:'显示已打开文件',exact:true}).count(),2)
  await screenshot('narrow-panes')
  await page.evaluate(()=>window.s.manager.closeSplit());await page.setViewportSize({width:1450,height:850})
 })
 assert.deepEqual(errors,[])
 console.log('METRICS '+JSON.stringify(metrics));console.log(`PASS ${results.length} tab navigation groups`)
}catch(error){
 console.error('UI STATE',await page?.locator('.breadcrumb,.navigation-popup').allTextContents())
 console.error('STRUCTURE',await page?.evaluate(()=>{const s=document.querySelector('.breadcrumb')?.__vueParentComponent?.setupState,m=window.s.manager;return {active:s?.props?.active,structure:s?.structure,activeSymbol:s?.activeSymbol,head:m.activeEditorView?.state.selection.main.head,doc:m.activeDocument}}))
 console.error('TREE',await page?.evaluate(()=>({selected:window.s.workspace.selectedTreePath,reads:window.f.reads,expanded:window.s.workspace.roots[0].entries.filter(n=>n.isExpanded).map(n=>n.path),top:document.querySelector('[role="tree"]')?.scrollTop})))
 await page?.screenshot({path:`${output}/failure.png`})
 throw error
}finally{
 fs.writeFileSync(`${output}/results.json`,JSON.stringify({results,errors,metrics},null,2))
 await browser?.close();await server.close()
}
