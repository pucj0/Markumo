import assert from 'node:assert/strict'
import fs from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createServer} from 'vite'

const {chromium} = await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const output = 'test-results/workspace-p0'
fs.mkdirSync(output, {recursive:true})
fs.writeFileSync(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import {createApp,reactive,markRaw,ref,h,nextTick} from 'vue';
import Sidebar from '/src/components/layout/Sidebar.vue';
import EditorPaneItem from '/src/components/layout/EditorPaneItem.vue';
import {DocumentManager} from '/src/editor/core/DocumentManager.ts';
import {FileController} from '/src/features/files/FileController.ts';
import {WorkspaceController} from '/src/features/workspace/WorkspaceController.ts';
import {TabGroup} from '/src/features/tabs/TabGroup.ts';
import * as paths from '/src/features/files/pathKey.ts';
import * as display from '/src/features/shell/pathDisplay.ts';
import * as settings from '/src/features/shell/editorSettings.ts';
import {treeWindow} from '/src/features/workspace/virtualTree.ts';
import '/src/styles/reset.css';import '/src/styles/variables.css';import '/src/styles/main.css';
const root='C:/fixture', key=display.displayPathKey;
const node=(name,directory=false)=>({id:name,name:name.split('/').pop(),path:root+'/'+name,relativePath:name,isDirectory:directory,isSymlink:false,isReadOnly:false,size:10,mtime:0,hasChildren:directory});
function file(path,token='token:'+path){return {kind:'text',path,name:path.split('/').pop(),token,text:'original '+path,encoding:'UTF-8',eol:'LF',bom:false,readOnly:false,version:'1'}}
function make(deferred=false){
 const manager=markRaw(new DocumentManager([],async()=>[])),calls=[],released=[],notices=[],pending=[],directories=new Map(),hidden=new Set();
 const files=markRaw(new FileController(manager,{release:async token=>released.push(token)},message=>notices.push(message)));
 const gateway={getRecentWorkspaces:async()=>[],isVisibleFile:async path=>!hidden.has(key(path)),
  readDirectory:async path=>{calls.push(['read',path]);const result=directories.get(key(path));return typeof result==='function'?await result():structuredClone(result||[])},
  openWorkspaceFile:async path=>{calls.push(['open',path]);if(!deferred)return file(path);return new Promise((resolve,reject)=>pending.push({path,resolve,reject}))},
  openWorkspacePath:async path=>({rootPath:path,name:'other',entries:[]}),removeWorkspaceFolder:async()=>{},
  renameNode:async(path,name)=>[path.slice(root.length+1),path.slice(root.length+1).split('/').slice(0,-1).concat(name).join('/')],
  moveNode:async(path,dest)=>[path.slice(root.length+1),dest.slice(root.length+1)+'/'+path.split('/').pop()],deleteNode:async path=>path.slice(root.length+1),cancelSearch:async()=>{}};
 const workspace=reactive(new WorkspaceController(markRaw(gateway),manager,files,message=>notices.push(message),false));
 const entries=[node('folder',true),node('lazy',true),node('a.txt'),node('b.txt')];
 directories.set(key(root+'/folder'),[node('folder/inside.txt')]);directories.set(key(root+'/lazy'),[node('lazy/deep.txt')]);
 workspace.restoreSession([{rootPath:root,name:'fixture',entries}]);
 return {manager,files,workspace,calls,released,notices,pending,directories,hidden,gateway,
  resolve:(path,token)=>{const p=pending.find(item=>key(item.path)===key(path));if(!p)throw Error('No pending '+path);pending.splice(pending.indexOf(p),1);p.resolve(file(p.path,token))}};
}
let app,current;
async function mount(large=false){
 if(app)app.unmount();if(current){current.workspace.destroy();current.files.dispose();current.manager.dispose()}
 const f=make();current=f;const revision=ref(0),state=reactive({follow:false,clickMode:'single',font:14,panel:'files'});
 f.manager.subscribe(()=>revision.value++);
 if(large){f.workspace.entries.splice(0,0,node('large',true));f.directories.set(key(root+'/large'),Array.from({length:6000},(_,i)=>node('large/f'+String(i).padStart(4,'0')+'.txt')))}
 app=createApp({setup:()=>()=>{revision.value;return h('div',{style:'display:flex;height:640px'},[
  h(Sidebar,{width:320,uiFontSize:state.font,activePanel:state.panel,activeDocId:f.manager.activeId,openDocs:f.manager.openedDocuments,recentFiles:[],workspace:f.workspace,manager:f.manager,desktop:false,treeClickMode:state.clickMode,autoFollowActiveFile:state.follow}),
  h('div',{style:'flex:1;min-width:0;display:flex;flex-direction:column'},[
   h('button',{id:'editor-focus'},'编辑器区域'),
   ...f.manager.layout.getAllPanes().map(pane=>h(EditorPaneItem,{key:pane.id,manager:f.manager,paneId:pane.id,revision:revision.value,files:f.files,desktop:false}))])])}});
 app.mount('#app');f.state=state;window.u=f;await nextTick();return true;
}
window.addEventListener('editor-notice',event=>current?.notices.push(event.detail));
window.f={root,node,file,make,mount,TabGroup,paths,display,settings,treeWindow};
`)

const server = await createServer({server:{host:'127.0.0.1',port:1437,strictPort:true}})
await server.listen()
let browser
const results = [], errors = []
try {
  browser = await chromium.launch({headless:true,...(process.env.MARKUMO_CHROME ? {executablePath:process.env.MARKUMO_CHROME} : {})})
  const page = await browser.newPage({viewport:{width:1150,height:780},reducedMotion:'reduce'})
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`http://127.0.0.1:1437/${output}/index.html`)
  await page.waitForFunction(()=>window.f)
  const test = async (name,run) => {await run();results.push(name);console.log('PASS '+name)}
  const row = path => page.locator(`[data-tree-path="C:/fixture/${path}"]`)
  const tree = page.getByRole('tree',{name:'工作区目录树'})
  const active = () => page.evaluate(()=>window.u.manager.activeDocument?.path)
  const idle = () => page.waitForTimeout(70)

  await test('async A -> B -> C: last intent wins and stale tokens are released',async()=>{
    const result=await page.evaluate(async()=>{const {make,node}=window.f,f=make(true);const a=f.workspace.openFile(node('a.txt')),b=f.workspace.openFile(node('b.txt')),c=f.workspace.openFile(node('c.txt'));f.resolve(node('c.txt').path);await c;f.resolve(node('a.txt').path);f.resolve(node('b.txt').path);await Promise.all([a,b]);return {active:f.manager.activeDocument.path,docs:f.manager.openedDocuments.length,released:f.released}})
    assert.equal(result.active,'C:/fixture/c.txt');assert.equal(result.docs,1);assert.equal(result.released.length,2)
  })
  await test('pending A cannot override an existing B activated through either tree or tabs',async()=>{
    for(const tab of [false,true]){
      const result=await page.evaluate(async tab=>{const {make,node,file}=window.f,f=make(true);f.files.accept(file(node('b.txt').path));const a=f.workspace.openFile(node('a.txt'));if(tab)f.manager.select(f.manager.activeId);else await f.workspace.openFile(node('b.txt'));f.resolve(node('a.txt').path);await a;return {active:f.manager.activeDocument.path,released:f.released.length}},tab)
      assert.equal(result.active,'C:/fixture/b.txt');assert.equal(result.released,1)
    }
  })
  await test('A -> B -> A reuses pending A; double click upgrades without a second read',async()=>{
    const result=await page.evaluate(async()=>{const {make,node}=window.f,f=make(true),a=node('a.txt');const first=f.workspace.openFile(a),b=f.workspace.openFile(node('b.txt')),last=f.workspace.openFile(a),pin=f.workspace.openFile(a,false);f.resolve(a.path);await Promise.all([first,last,pin]);f.resolve(node('b.txt').path);await b;return {active:f.manager.activeDocument.path,pinned:f.manager.group.tabs[0].pinned,reads:f.calls.filter(([type,path])=>type==='open'&&path===a.path).length}})
    assert.equal(result.active,'C:/fixture/a.txt');assert.equal(result.pinned,true);assert.equal(result.reads,1)
  })
  await test('multi-pane same-file requests share a document and preserve pane-specific pin state/focus',async()=>{
    const result=await page.evaluate(async()=>{const {make,node}=window.f,f=make(true),a=node('a.txt');const first=f.workspace.openFile(a);const secondPane=f.manager.layout.splitPane('main','right');const second=f.workspace.openFile(a,false);f.manager.focusPane('main',false);f.resolve(a.path);await Promise.all([first,second]);return {activePane:f.manager.activePaneId,docs:f.manager.openedDocuments.length,reads:f.calls.length,tabs:f.manager.layout.getAllPanes().map(p=>p.group.tabs)}})
    assert.equal(result.activePane,'main');assert.equal(result.docs,1);assert.equal(result.reads,1);assert.equal(result.tabs[0][0].pinned,false);assert.equal(result.tabs[1][0].pinned,true);assert.equal(result.tabs[0][0].documentId,result.tabs[1][0].documentId)
  })
  await test('workspace switch and pane closure discard old responses; failed reads can retry',async()=>{
    const result=await page.evaluate(async()=>{const {make,node,root}=window.f,f=make(true);let a=f.workspace.openFile(node('a.txt'));await f.workspace.openWorkspacePath('C:/other');f.resolve(node('a.txt').path);await a;const stale=f.manager.openedDocuments.length;const b=f.workspace.openFile(node('retry.txt'));f.pending[0].reject('fixture failure');await b;f.pending.splice(0,1);const retry=f.workspace.openFile(node('retry.txt'));f.resolve(node('retry.txt').path);await retry;const pane=f.manager.layout.splitPane('main','right'),gone=f.workspace.openFile(node('gone.txt'));f.manager.closePane(pane);f.resolve(node('gone.txt').path);await gone;return {stale,released:f.released.length,active:f.manager.activeDocument.path,failures:f.notices.filter(n=>n.includes('fixture failure')).length}})
    assert.equal(result.stale,0);assert.equal(result.released,2);assert.equal(result.active,'C:/fixture/retry.txt');assert.equal(result.failures,1)
  })
  await test('dirty preview is pinned and cannot be replaced; reopens preserve history/selection',async()=>{
    const result=await page.evaluate(async()=>{const {make,node}=window.f,f=make();await f.workspace.openFile(node('a.txt'));const id=f.manager.activeId;f.manager.dispatch(id,{changes:{from:0,insert:'edit '},selection:{anchor:3}});const state=f.manager.getState(id);await f.workspace.openFile(node('b.txt'));await f.workspace.openFile(node('a.txt'));await f.workspace.openFile(node('a.txt'),false);return {count:f.manager.openedDocuments.length,same:f.manager.getState(id)===state,text:f.manager.getText(id),selection:f.manager.getState(id).selection.main.head,pinned:f.manager.group.tabs.find(t=>t.documentId===id).pinned}})
    assert.equal(result.count,2);assert.equal(result.same,true);assert.ok(result.text.startsWith('edit '));assert.equal(result.selection,3);assert.equal(result.pinned,true)
  })
  await test('mutations invalidate pending reads and newly created files still open after the mutation',async()=>{
    const result=await page.evaluate(async()=>{const {make,node}=window.f,f=make(true),a=f.workspace.openFile(node('a.txt'));let finish;f.gateway.renameNode=()=>new Promise(resolve=>finish=resolve);const rename=f.workspace.renameNode(f.workspace.entries[0],'renamed');await f.workspace.openFile(node('blocked.txt'));f.resolve(node('a.txt').path);await a;const before=f.manager.openedDocuments.length;finish(['folder','renamed']);await rename;f.gateway.createFile=async()=>node('created.txt');const created=f.workspace.createFile('C:/fixture','created.txt');await new Promise(resolve=>setTimeout(resolve,0));f.resolve(node('created.txt').path);await created;return {before,released:f.released.length,active:f.manager.activeDocument.path,blocked:f.calls.some(([type,path])=>path.endsWith('blocked.txt'))}})
    assert.equal(result.before,0);assert.equal(result.released,1);assert.equal(result.active,'C:/fixture/created.txt');assert.equal(result.blocked,false)
  })
  await test('search result opens participate in latest-intent ordering',async()=>{
    const result=await page.evaluate(async()=>{const {make,node,file}=window.f,f=make(true);f.files.accept(file(node('b.txt').path));const b=f.manager.activeId,a=f.workspace.locateMatch({path:node('a.txt').path,relative_path:'a.txt',line_number:1,column_number:1});f.manager.select(b);f.resolve(node('a.txt').path);await a;return {active:f.manager.activeDocument.path,released:f.released.length}})
    assert.equal(result.active,'C:/fixture/b.txt');assert.equal(result.released,1)
  })
  await test('tree selection tracks rename/move/delete and resets on workspace switch',async()=>{
    const result=await page.evaluate(async()=>{const {make,node}=window.f,f=make(),folder=f.workspace.entries[0];folder.children=[node('folder/inside.txt')];f.workspace.selectTreePath(folder.children[0].path);await f.workspace.renameNode(folder,'renamed');const renamed=f.workspace.selectedTreePath;f.directories.set('c:/fixture',[node('dest',true)]);await f.workspace.moveNode(folder,'C:/fixture/dest');const moved=f.workspace.selectedTreePath;await f.workspace.deleteNode({...folder,path:'C:/fixture/dest/renamed'});const deleted=f.workspace.selectedTreePath;f.workspace.selectTreePath('C:/fixture/a.txt');await f.workspace.openWorkspacePath('C:/other');return {renamed,moved,deleted,switched:f.workspace.selectedTreePath}})
    assert.equal(result.renamed,'C:/fixture/renamed/inside.txt');assert.equal(result.moved,'C:/fixture/dest/renamed/inside.txt');assert.equal(result.deleted,null);assert.equal(result.switched,null)
  })
  await test('path keys cover Windows extended/UNC, Linux/macOS case sensitivity and path boundaries',async()=>{
    const result=await page.evaluate(()=>{const {paths:p,display:d,make}=window.f,f=make();return [p.sameFilePath('C:\\Repo\\A.txt','c:/repo/a.txt',true),p.sameFilePath('\\\\?\\C:\\Repo\\A.txt','c:/repo/a.txt',true),p.sameFilePath('/repo/A.txt','/repo/a.txt',false),p.sameFilePath('/Users/me/A.txt','/Users/me/a.txt',false),d.displayPathKey('\\\\?\\UNC\\Server\\Share\\A.txt')===d.displayPathKey('//server/share/a.txt'),f.workspace.rootForPath('C:/fixture-other/a.txt'),p.usesCaseInsensitivePaths('MacIntel'),p.usesCaseInsensitivePaths('Linux x86_64'),p.usesCaseInsensitivePaths('Win32')]})
    assert.deepEqual(result,[true,true,false,false,true,null,false,false,true])
  })
  await test('refresh preserves loaded folder state and clears only selections known to be removed',async()=>{
    const result=await page.evaluate(async()=>{const {make,node,root}=window.f,f=make();await f.workspace.toggleFolder(f.workspace.entries[0]);f.workspace.selectTreePath(node('folder/inside.txt').path);f.directories.set('c:/fixture',[node('folder',true),node('b.txt')]);await f.workspace.refreshDirectory();const preserved={selected:f.workspace.selectedTreePath,expanded:f.workspace.entries[0].isExpanded,loaded:f.workspace.entries[0].children.length};f.directories.set('c:/fixture/folder',[]);await f.workspace.refreshDirectory(f.workspace.entries[0]);return {preserved,selected:f.workspace.selectedTreePath}})
    assert.equal(result.preserved.selected,'C:/fixture/folder/inside.txt');assert.equal(result.preserved.expanded,true);assert.equal(result.preserved.loaded,1);assert.equal(result.selected,null)
  })
  await test('moving a selected file updates both loaded parent lists and reveal reuses the destination cache',async()=>{
    const result=await page.evaluate(async()=>{const {make,node}=window.f,f=make();await f.workspace.toggleFolder(f.workspace.entries[0]);await f.workspace.toggleFolder(f.workspace.entries[1]);const moved=f.workspace.entries[0].children[0];f.workspace.selectTreePath(moved.path);f.directories.set('c:/fixture',[node('folder',true),node('lazy',true)]);await f.workspace.moveNode(moved,'C:/fixture/lazy');const reads=f.calls.filter(([type])=>type==='read').length,found=await f.workspace.revealFileInTree('C:/fixture/lazy/inside.txt');return {found,reads,after:f.calls.filter(([type])=>type==='read').length,source:f.workspace.entries[0].children.map(n=>n.path),dest:f.workspace.entries[1].children.map(n=>n.path),selected:f.workspace.selectedTreePath}})
    assert.equal(result.found,true);assert.equal(result.after,result.reads);assert.deepEqual(result.source,[]);assert.ok(result.dest.includes('C:/fixture/lazy/inside.txt'));assert.equal(result.selected,'C:/fixture/lazy/inside.txt')
  })
  await test('a file added outside the tree refreshes only the missing cached parent',async()=>{
    const result=await page.evaluate(async()=>{const {make,node}=window.f,f=make();await f.workspace.toggleFolder(f.workspace.entries[0]);f.workspace.entries[0].isExpanded=false;f.directories.set('c:/fixture/folder',[node('folder/inside.txt'),node('folder/added.txt')]);const start=f.calls.length,found=await f.workspace.revealFileInTree('C:/fixture/folder/added.txt');return {found,reads:f.calls.slice(start),expanded:f.workspace.entries[0].isExpanded}})
    assert.equal(result.found,true);assert.equal(result.expanded,true);assert.deepEqual(result.reads,[['read','C:/fixture/folder']])
  })
  await test('workspace defaults, legacy double-click choice and follow setting persist',async()=>{
    const result=await page.evaluate(async()=>{const s=window.f.settings,defaults=s.defaultSettings(),old=s.settingsFrom({treeClickMode:'double'}),custom=s.settingsFrom({autoFollowActiveFile:true,treeClickMode:'single'});await s.saveEditorSettings(custom);const loaded=await s.loadEditorSettings();const group=new window.f.TabGroup();group.open('a',false);group.open('b',true);group.unpin('a');return {defaults:[defaults.treeClickMode,defaults.autoFollowActiveFile],old:[old.treeClickMode,old.autoFollowActiveFile],loaded:[loaded.autoFollowActiveFile,loaded.treeClickMode],previews:group.tabs.filter(t=>!t.pinned).map(t=>t.documentId)}})
    assert.deepEqual(result.defaults,['single',false]);assert.deepEqual(result.old,['double',false]);assert.deepEqual(result.loaded,[true,'single']);assert.deepEqual(result.previews,['a'])
  })
  await test('real mouse click previews; double click pins original tab; folder selection preserves active marker',async()=>{
    await page.evaluate(()=>window.f.mount())
    await row('a.txt').click();await idle();assert.equal(await active(),'C:/fixture/a.txt');assert.equal(await page.locator('.tab.temp').count(),1)
    await row('a.txt').dblclick();await idle();assert.equal(await page.locator('.tab').count(),1);assert.equal(await page.locator('.tab.pinned').count(),1)
    await row('folder').click();await idle();assert.equal(await row('a.txt').getAttribute('aria-current'),'page');assert.equal(await row('a.txt').getAttribute('aria-selected'),'false');assert.equal(await row('folder').getAttribute('aria-selected'),'true')
    await row('b.txt').click();await row('b.txt').dblclick();await idle();assert.equal(await page.locator('.tab').count(),2)
    const calls=await page.evaluate(()=>window.u.calls.filter(([type,path])=>type==='open'&&path.endsWith('b.txt')).length);assert.equal(calls,1)
  })
  await test('folder double clicks toggle once in either mode, including twisties and roots',async()=>{
    await page.evaluate(()=>window.f.mount());await row('folder').dblclick();await idle();assert.equal(await row('folder').getAttribute('aria-expanded'),'true')
    await row('folder').locator('.twisty').dblclick();await idle();assert.equal(await row('folder').getAttribute('aria-expanded'),'false')
    await page.evaluate(()=>window.u.state.clickMode='double');await row('folder').click();assert.equal(await row('folder').getAttribute('aria-expanded'),'false');await row('folder').dblclick();await idle();assert.equal(await row('folder').getAttribute('aria-expanded'),'true')
    const root=page.locator('[data-tree-path="C:/fixture"]');await root.dblclick();assert.equal(await root.getAttribute('aria-expanded'),'false');await root.locator('.twisty').dblclick();assert.equal(await root.getAttribute('aria-expanded'),'true');assert.equal(await page.locator('.tab').count(),0)
  })
  await test('production pane tabs pin independently; active-file marker follows the focused pane',async()=>{
    await page.evaluate(async()=>{await window.f.mount();const f=window.u;await f.workspace.openFile(window.f.node('a.txt'));f.manager.layout.splitPane('main','right');await f.workspace.openFile(window.f.node('a.txt'))});await idle()
    const main=page.locator('[data-pane-id="main"]'),secondary=page.locator('[data-pane-id="secondary"]')
    assert.equal(await main.locator('.tab.temp').count(),1);assert.equal(await secondary.locator('.tab.temp').count(),1)
    await secondary.locator('.tab').dblclick();assert.equal(await secondary.locator('.tab.pinned').count(),1);assert.equal(await main.locator('.tab.temp').count(),1)
    await page.evaluate(()=>window.u.workspace.openFile(window.f.node('b.txt'),false));await row('folder').click();await main.locator('.tab').click();assert.equal(await row('a.txt').getAttribute('aria-current'),'page');assert.equal(await row('folder').getAttribute('aria-selected'),'true')
    await secondary.getByRole('tab',{name:'b.txt',exact:true}).click();assert.equal(await row('b.txt').getAttribute('aria-current'),'page');assert.equal(await row('a.txt').getAttribute('aria-current'),null)
  })
  await test('right-click selects without opening; keyboard Enter/Space/arrows have tree semantics',async()=>{
    await page.evaluate(()=>window.f.mount());await row('a.txt').click({button:'right'});assert.equal(await page.locator('.tab').count(),0);assert.equal(await row('a.txt').getAttribute('aria-selected'),'true');await page.keyboard.press('Escape')
    await row('folder').focus();await page.keyboard.press('Space');assert.equal(await row('folder').getAttribute('aria-expanded'),'false');await page.keyboard.press('ArrowRight');await idle();assert.equal(await row('folder').getAttribute('aria-expanded'),'true');await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.dataset.treePath),'C:/fixture/folder/inside.txt')
    await page.keyboard.press('Space');await idle();assert.equal(await page.locator('.tab.temp').count(),1);await page.keyboard.press('Enter');assert.equal(await page.locator('.tab.pinned').count(),1);await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>document.activeElement.dataset.treePath),'C:/fixture/folder');await page.keyboard.press('ArrowLeft');assert.equal(await row('folder').getAttribute('aria-expanded'),'false')
  })
  await test('tab switching does not expand, select or scroll when following is off',async()=>{
    await page.evaluate(()=>window.f.mount(true));await row('large').click();await idle();await tree.evaluate(el=>el.scrollTop=5000);await idle()
    const before=await tree.evaluate(el=>el.scrollTop)
    await page.evaluate(()=>window.u.files.accept(window.f.file('C:/fixture/lazy/deep.txt')));await idle()
    assert.equal(await tree.evaluate(el=>el.scrollTop),before);assert.equal(await page.evaluate(()=>window.u.workspace.entries.find(n=>n.name==='lazy').isExpanded||false),false);assert.equal(await page.evaluate(()=>window.u.workspace.selectedTreePath),'C:/fixture/large')
  })
  await test('manual scrolling leaves a keyboard tab stop and panel switches restore tree position',async()=>{
    await page.evaluate(()=>window.f.mount(true));await row('large').click();await idle();await tree.evaluate(el=>el.scrollTop=6000);await idle();assert.equal(await tree.locator('[role=treeitem][tabindex="0"]').count(),1)
    await page.evaluate(()=>window.u.state.panel='search');await idle();await page.evaluate(()=>window.u.state.panel='files');await idle();assert.equal(await tree.evaluate(el=>el.scrollTop),6000)
  })
  await test('explicit locate expands cached parents, centers virtual targets and repeats its highlight',async()=>{
    await page.evaluate(()=>window.f.mount(true));await page.evaluate(()=>window.u.files.accept(window.f.file('C:/fixture/large/f4500.txt')))
    await page.getByRole('button',{name:'定位当前文件',exact:true}).click();await idle()
    const target=row('large/f4500.txt');assert.equal(await target.count(),1)
    const distance=await target.evaluate(el=>{const parent=el.closest('[role=tree]').getBoundingClientRect(),r=el.getBoundingClientRect();return Math.abs((r.top+r.bottom-parent.top-parent.bottom)/2)});assert.ok(distance<35)
    const reads=await page.evaluate(()=>window.u.calls.filter(([type])=>type==='read').length);const before=await tree.evaluate(el=>el.scrollTop)
    await page.waitForTimeout(1250);assert.equal(await target.evaluate(el=>el.classList.contains('locate-highlight')),false)
    await page.getByRole('button',{name:'定位当前文件',exact:true}).click();await idle();assert.equal(await target.evaluate(el=>el.classList.contains('locate-highlight')),true);assert.equal(await tree.evaluate(el=>el.scrollTop),before);assert.equal(await page.evaluate(()=>window.u.calls.filter(([type])=>type==='read').length),reads)
    assert.ok(await tree.getByRole('treeitem').count()<80)
  })
  await test('auto-follow scrolls only as needed and does not replace selection or interrupt browsing',async()=>{
    await page.evaluate(()=>window.f.mount(true));await page.locator('#editor-focus').click();await page.evaluate(()=>{window.u.state.follow=true;window.u.files.accept(window.f.file('C:/fixture/large/f4000.txt'))});await idle()
    assert.equal(await row('large/f4000.txt').count(),1);const before=await tree.evaluate(el=>el.scrollTop)
    await page.evaluate(()=>window.u.files.accept(window.f.file('C:/fixture/large/f3999.txt')));await idle();assert.equal(await tree.evaluate(el=>el.scrollTop),before);assert.equal(await page.evaluate(()=>window.u.workspace.selectedTreePath),null)
    await tree.evaluate(el=>{el.scrollTop=1000;el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-20}))});await idle();await page.evaluate(()=>window.u.files.accept(window.f.file('C:/fixture/large/f5500.txt')));await idle();assert.equal(await tree.evaluate(el=>el.scrollTop),1000)
    await page.evaluate(()=>window.u.state.follow=false);await page.waitForTimeout(850);await page.evaluate(()=>window.u.files.accept(window.f.file('C:/fixture/lazy/deep.txt')));await idle();assert.equal(await tree.evaluate(el=>el.scrollTop),1000)
  })
  await test('wheel browsing and workspace switch cancel delayed reveal before expansion/scroll',async()=>{
    await page.evaluate(()=>window.f.mount(true));await row('large').click();await idle();await page.evaluate(()=>{window.u.directories.set('c:/fixture/lazy',()=>new Promise(resolve=>window.finishDirectory=resolve));window.u.files.accept(window.f.file('C:/fixture/lazy/deep.txt'))})
    await page.getByRole('button',{name:'定位当前文件',exact:true}).click();await idle();await tree.evaluate(el=>{el.scrollTop=1200;el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:10}))});await page.evaluate(()=>window.finishDirectory([window.f.node('lazy/deep.txt')]));await idle();assert.equal(await tree.evaluate(el=>el.scrollTop),1200);assert.equal(await page.evaluate(()=>window.u.workspace.entries.find(n=>n.name==='lazy').isExpanded||false),false)
    await page.evaluate(()=>{window.u.workspace.entries.find(n=>n.name==='lazy').children=undefined;window.u.directories.set('c:/fixture/lazy',()=>new Promise(resolve=>window.finishDirectory=resolve))});await page.getByRole('button',{name:'定位当前文件',exact:true}).click();await idle();await page.evaluate(async()=>{await window.u.workspace.openWorkspacePath('C:/other');window.finishDirectory([window.f.node('lazy/deep.txt')])});await idle();assert.equal(await page.evaluate(()=>window.u.workspace.rootPath),'C:/other');assert.equal(await tree.evaluate(el=>el.scrollTop),0)
  })
  await test('missing, ignored and external targets give feedback without changing the tree',async()=>{
    await page.evaluate(()=>window.f.mount());await page.evaluate(()=>{window.u.hidden.add('c:/fixture/lazy/deep.txt');window.u.files.accept(window.f.file('C:/fixture/lazy/deep.txt'))});await page.getByRole('button',{name:'定位当前文件',exact:true}).click();await idle();assert.equal(await row('lazy').getAttribute('aria-expanded'),'false');assert.ok((await page.evaluate(()=>window.u.notices)).some(n=>n.includes('被忽略')))
    await page.evaluate(()=>window.u.files.accept(window.f.file('C:/outside/a.txt')));await page.getByRole('button',{name:'定位当前文件',exact:true}).click();assert.ok((await page.evaluate(()=>window.u.notices)).some(n=>n.includes('不在工作区')))
    await page.evaluate(()=>{window.u.hidden.clear();window.u.files.accept(window.f.file('C:/fixture/lazy/missing.txt'))});await page.getByRole('button',{name:'定位当前文件',exact:true}).click();await idle();assert.equal(await row('lazy').getAttribute('aria-expanded'),'false');assert.equal(await page.evaluate(()=>window.u.workspace.selectedTreePath),null)
  })
  await test('virtual tree keyboard navigation and locate adapt to 20px fonts in both themes',async()=>{
    await page.evaluate(()=>window.f.mount(true));await row('large').click();await idle();await row('large').focus();await page.keyboard.press('End');await idle();assert.equal(await page.evaluate(()=>document.activeElement.dataset.treePath),'C:/fixture/b.txt');assert.ok(await tree.getByRole('treeitem').count()<80)
    await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement.dataset.treePath),'C:/fixture')
    for(const theme of ['dark','light']){
      await page.evaluate(theme=>{document.body.classList.toggle('light',theme==='light');document.documentElement.style.setProperty('--ui-font-size','20px');window.u.state.font=20;window.u.files.accept(window.f.file('C:/fixture/large/f3000.txt'))},theme)
      await page.getByRole('button',{name:'定位当前文件',exact:true}).click();await idle();const target=row('large/f3000.txt');assert.equal(await target.count(),1);assert.equal(await target.evaluate(el=>el.getBoundingClientRect().height),34);assert.equal(await tree.evaluate(el=>el.scrollWidth<=el.clientWidth),true);await page.screenshot({path:output+'/tree-'+theme+'.png'})
    }
  })
  assert.deepEqual(errors,[])
  fs.writeFileSync(`${output}/results.json`,JSON.stringify({passed:results.length,tests:results},null,2))
  console.log('PASS all '+results.length+' workspace P0 regressions')
} catch(error) {
  if(browser){const page=browser.contexts()[0]?.pages()[0];if(page)await page.screenshot({path:`${output}/failure.png`})}
  throw error
} finally {await browser?.close();await server.close()}
