import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const { chromium } = await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const output = 'test-results/workspace-replace'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { createApp, reactive, markRaw } from 'vue';
import App from '/src/App.vue';
import { DocumentManager } from '/src/editor/core/DocumentManager.ts';
import { FileController } from '/src/features/files/FileController.ts';
import { WorkspaceController } from '/src/features/workspace/WorkspaceController.ts';
import { getPresetBindings } from '/src/features/shell/keybindings/presets.ts';
import { validatePresetConflicts } from '/src/features/shell/keybindings/conflict.ts';
import vectors from '/scripts/fixtures/workspace-replace.json';
import '/src/styles/reset.css'; import '/src/styles/variables.css'; import '/src/styles/main.css';
const root='C:/replace-fixture', calls=[], notices=[];
const info={root_path:root,name:'replace-fixture',entries:[]};
window.isTauri=true; mockWindows('main');
mockIPC(async(command,args)=>{
 calls.push({command,args});
 if(command==='plugin:event|listen')return args.handler;
 if(command==='load_editor_settings')return {externalFileMonitoring:false,autoSave:false};
 if(command==='initialize_launch')return {kind:'app',ownsSession:true,files:{files:[],errors:[]},roots:[info],activePath:null,layout:{mode:'workspace',sidebarWidth:350,sidebarVisible:true},warnings:[]};
 if(command==='file_preferences')return {recent:[],layout:{mode:'workspace',sidebarWidth:350,sidebarVisible:true}};
 if(command==='get_recent_workspaces')return [];
 if(command==='drain_pending')return {files:[],errors:[]};
 if(command==='update_runtime')return {version:'1.0.5',platform:'windows',installSupported:false};
 if(command==='recovery_list')return {records:[],warnings:[]};
 if(command==='search_workspace') {
  queueMicrotask(()=>{const w=window.s?.workspace;if(w){w.onSearchBatch([{search_id:args.query.search_id,path:root+'/a.txt',relative_path:'a.txt',line_number:1,column_number:1,line_text:'foo foo',match_length:3}]);w.onSearchDone({search_id:args.query.search_id,total:1,canceled:false})}});
  return 1;
 }
 if(command==='preview_workspace_replace')return {files:[{path:root+'/a.txt',version:'1',buffer:false,edits:[{from:0,to:3,line:1,column:1,before:'foo',insert:args.replacement,context:'foo foo'},{from:4,to:7,line:1,column:5,before:'foo',insert:args.replacement,context:'foo foo'}]}],skipped:[],limited:false,canceled:false};
 if(command==='apply_workspace_replace')return args.request.selected.length;
 if(command==='read_directory' || command==='find_workspace_files')return [];
 return null;
});
window.addEventListener('editor-notice',event=>notices.push(event.detail));
const app=createApp(App);app.mount('#app');window.s=app._instance.setupState;
function file(text,path=root+'/a.txt'){return {kind:'text',path,name:path.split('/').pop(),token:'token:'+path,text,encoding:'UTF-8',bom:false,eol:'LF',readOnly:false,version:'1'}}
function make(vector=vectors[0], closed=false, count=1){
 const manager=markRaw(new DocumentManager([],async()=>[])),notifications=[],applied=[],queries=[],cancelIds=[];
 const files=markRaw(new FileController(manager,{release:async()=>{}},message=>notifications.push(message)));
 let hold=null, failure=null;
 const gateway=markRaw({getRecentWorkspaces:async()=>[],cancelSearch:async id=>cancelIds.push(id),searchWorkspace:async query=>{queries.push(query);return 0},validateReplace:async()=>{},
  previewReplace:async(query,replacement,targets)=>{
   if(hold)await hold;
   return {files:Array.from({length:count},(_,i)=>({path:root+'/'+String.fromCharCode(97+i)+'.txt',version:'1',buffer:!closed,edits:vector.edits.map(([from,to,insert])=>({from,to,insert,line:1,column:from+1,before:vector.text.slice(from,to),context:vector.text.slice(0,180)}))})).filter(f=>!targets.length||targets.includes(f.path)),skipped:[],limited:count>=1000,canceled:false}
  },applyReplace:async request=>{applied.push(request);if(failure===request.path)throw Error('permission denied');return request.selected.length}});
 const workspace=reactive(new WorkspaceController(gateway,manager,files,message=>notifications.push(message),false));
 workspace.restoreSession([{rootPath:root,name:'fixture',entries:[]}]);workspace.searchQuery=vector.query;workspace.isRegex=vector.regex;workspace.isWholeWord=vector.whole;workspace.isCaseSensitive=vector.caseSensitive;workspace.replacementText=vector.replacement;
 let id;
 if(!closed){files.accept(file('disk baseline'));id=manager.activeId;manager.dispatch(id,{changes:{from:0,to:manager.getState(id).doc.length,insert:vector.text}})}
 return {manager,files,workspace,applied,queries,notifications,cancelIds,id,setHold:p=>hold=p,setFailure:path=>failure=path};
}
window.f={make,vectors,root,file,calls,notices,getPresetBindings,validatePresetConflicts};
`)

const port = Number(process.env.MARKUMO_TEST_PORT || 1469)
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null } })
await server.listen()
let browser
const results = [], errors = []
try {
  browser = await chromium.launch({ headless: true, ...(process.env.MARKUMO_CHROME ? { executablePath: process.env.MARKUMO_CHROME } : {}) })
  const page = await browser.newPage({ viewport: { width: 1200, height: 840 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${port}/${output}/index.html`)
  await page.waitForFunction(() => window.s?.settingsReady && !window.s.startupLoading && window.f)
  const test = async (name, run) => { await run(); results.push(name); console.log('PASS ' + name) }

  await test('shared native vectors apply UTF16 ranges as isolated transactions with undo/redo', async () => {
    const results = await page.evaluate(() => window.f.vectors.filter(v => !v.text.includes('\r')).map(vector => {
      const f=window.f.make(vector),m=f.manager,id=f.id,snapshot=m.getState(id).doc
      const changed=m.applyWorkspaceReplacement(id,snapshot,vector.edits.map(([from,to,insert])=>({from,to,insert})))
      const after=m.getText(id);m.command('undo');const undone=m.getText(id);m.command('redo');const redone=m.getText(id)
      return {name:vector.name,changed,after,expected:vector.after,undone,before:vector.text,redone}
    }))
    for(const result of results){assert.equal(result.changed,true,result.name);assert.equal(result.after,result.expected,result.name);assert.equal(result.undone,result.before,result.name);assert.equal(result.redone,result.expected,result.name)}
  })

  await test('unsaved buffer, partial selection, multi-pane consistency, result refresh', async () => {
    const result=await page.evaluate(async()=>{
      const f=window.f.make(),w=f.workspace,m=f.manager,id=f.id;const second=m.splitPane('right','main',id)
      const hosts=[document.createElement('div'),document.createElement('div')];for(const host of hosts)document.body.append(host);m.mountPane(hosts[0],'main');m.mountPane(hosts[1],second)
      await w.previewReplace();const before=m.getText(id),buffer=w.replaceFiles[0].buffer
      w.selectReplacements(false);w.toggleReplacement(w.replaceFiles[0],1);await w.applyReplacements()
      const after=m.getText(id),panes=m.layout.getAllPanes().map(p=>p.group.activeId),dirty=m.metadata(id).dirty
      m.command('undo');const undo=m.getText(id);m.command('redo')
      const views=hosts.map(host=>host.querySelector('.cm-content')?.textContent);m.unmount('main');m.unmount(second);hosts.forEach(host=>host.remove())
      return {before,buffer,after,panes,views,dirty,undo,redo:m.getText(id),writes:f.applied.length,query:f.queries.at(-1),message:w.replaceMessage}
    })
    assert.equal(result.before,'a A a');assert.equal(result.buffer,true);assert.equal(result.after,'a $1 a');assert.equal(new Set(result.panes).size,1);assert.deepEqual(result.views,['a $1 a','a $1 a']);assert.equal(result.dirty,true);assert.equal(result.undo,'a A a');assert.equal(result.redo,'a $1 a');assert.equal(result.writes,0);assert.equal(result.query.buffers[0].text,'a $1 a');assert.match(result.message,/成功 1/)
  })

  await test('stale buffer and edit/undo cycle reject preview identity without writing', async () => {
    for (const undo of [false,true]) {
      const result=await page.evaluate(async undo=>{const f=window.f.make();await f.workspace.previewReplace();f.manager.applyWorkspaceReplacement(f.id,f.manager.getState(f.id).doc,[{from:0,to:0,insert:'new '}]);if(undo)f.manager.command('undo');await f.workspace.applyReplacements();return {text:f.manager.getText(f.id),status:f.workspace.replaceFiles[0].status,writes:f.applied.length}},undo)
      assert.match(result.status,/失败/);assert.equal(result.writes,0);assert.equal(result.text,undo?'a A a':'new a A a')
    }
  })

  await test('opened mixed line endings and BOM metadata survive replacement/save snapshot', async () => {
    const result=await page.evaluate(()=>{const f=window.f.make(undefined,true),m=f.manager;const opened=window.f.file('A\r\nA\nA\r');opened.bom=true;opened.eol='Mixed';f.files.accept(opened);const id=m.activeId;m.applyWorkspaceReplacement(id,m.getState(id).doc,[{from:0,to:1,insert:'b'},{from:2,to:3,insert:'b'}]);const snapshot=m.saveSnapshot(id);return {text:snapshot.text,bom:snapshot.metadata.bom,eol:snapshot.metadata.eol,encoding:snapshot.metadata.encoding}})
    assert.deepEqual(result,{text:'b\r\nb\nA\r',bom:true,eol:'Mixed',encoding:'UTF-8'})
    const noop=await page.evaluate(()=>{const f=window.f.make(),m=f.manager,snapshot=m.getState(f.id).doc;const accepted=m.applyWorkspaceReplacement(f.id,snapshot,[{from:0,to:0,insert:''}]);return {accepted,same:m.getState(f.id).doc===snapshot}})
    assert.deepEqual(noop,{accepted:true,same:true})
  })

  await test('closed multi-file success/failure reporting and selected indices', async () => {
    const result=await page.evaluate(async()=>{const f=window.f.make(undefined,true,3),w=f.workspace;f.setFailure(window.f.root+'/b.txt');await w.previewReplace();w.selectReplacements(false);w.toggleReplacement(w.replaceFiles[0],1);w.selectReplacements(true,w.replaceFiles[1].path);await w.applyReplacements();return {applied:f.applied,status:w.replaceFiles.map(f=>f.status),message:w.replaceMessage}})
    assert.equal(result.applied.length,2);assert.deepEqual(result.applied[0].selected,[1]);assert.deepEqual(result.applied[0].query.buffers,[]);assert.match(result.status[0],/已保存/);assert.match(result.status[1],/失败.*permission/);assert.equal(result.status[2],'');assert.match(result.message,/成功 1.*失败 1/)
  })

  await test('cancel stops remaining files and consumes no stale preview; search settings invalidate', async () => {
    const result=await page.evaluate(async()=>{const f=window.f.make(undefined,true,3),w=f.workspace;await w.previewReplace();const apply=f.workspace.gateway.applyReplace;f.workspace.gateway.applyReplace=async request=>{const result=await apply(request);w.cancelReplace();return result};await w.applyReplacements();return {writes:f.applied.length,status:w.replaceFiles.map(f=>f.status),message:w.replaceMessage}})
    assert.equal(result.writes,1);assert.match(result.status[1],/已取消/);assert.match(result.status[2],/已取消/);assert.match(result.message,/取消 2/)
    const stale=await page.evaluate(async()=>{const f=window.f.make(undefined,true);await f.workspace.previewReplace();f.workspace.isRegex=!f.workspace.isRegex;await f.workspace.applyReplacements();return {writes:f.applied.length,message:f.workspace.replaceMessage}})
    assert.equal(stale.writes,0);assert.match(stale.message,/条件已变化/)
    const canceled=await page.evaluate(async()=>{const f=window.f.make();let resolve;f.setHold(new Promise(r=>resolve=r));const preview=f.workspace.previewReplace();f.workspace.cancelReplace();resolve();await preview;return {files:f.workspace.replaceFiles.length,canceled:f.cancelIds.length,busy:f.workspace.replaceBusy}})
    assert.deepEqual(canceled,{files:0,canceled:1,busy:false})
  })

  await test('file opened after preview cannot receive a closed-file disk write', async () => {
    const result=await page.evaluate(async()=>{const f=window.f.make(undefined,true);await f.workspace.previewReplace();f.files.accept(window.f.file('new buffer'));await f.workspace.applyReplacements();return {writes:f.applied.length,status:f.workspace.replaceFiles[0].status,text:f.manager.getText(f.manager.activeId)}})
    assert.equal(result.writes,0);assert.match(result.status,/文件已打开/);assert.equal(result.text,'new buffer')
  })

  await test('Ctrl+Shift+F/R route through real app command registry and focus repeatedly', async () => {
    await page.keyboard.press('Control+Shift+f')
    await page.waitForFunction(()=>document.activeElement?.classList.contains('search-input'))
    await page.keyboard.press('Control+Shift+r')
    await page.getByRole('textbox',{name:'替换为',exact:true}).waitFor()
    assert.equal(await page.getByRole('textbox',{name:'替换为',exact:true}).evaluate(el=>document.activeElement===el),true)
    await page.keyboard.press('Control+Shift+f')
    assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('.search-box input')),true)
    const bindings=await page.evaluate(()=>['markumo','fleet'].map(p=>{const b=window.f.getPresetBindings(p);return {search:b['workspace-search'],replace:b['workspace-replace'],errors:window.f.validatePresetConflicts(b)}}))
    for(const b of bindings){assert.equal(b.search,'Mod+Shift+F');assert.equal(b.replace,'Mod+Shift+R');assert.deepEqual(b.errors,[])}
  })

  await test('sidebar preview, exclusion, file actions, progress report and bounded 1000-result rendering', async () => {
    await page.locator('.search-box input').fill('foo');await page.locator('.search-box input').press('Enter')
    await page.waitForFunction(()=>!window.s.workspace.searching && window.s.workspace.searchQuery==='foo')
    await page.getByRole('textbox',{name:'替换为',exact:true}).fill('bar')
    await page.getByRole('button',{name:'预览全部替换',exact:true}).click()
    await page.waitForFunction(()=>window.s.workspace.replaceFiles.length===1)
    assert.equal(await page.locator('.replace-diff del').count(),2);assert.equal(await page.locator('.replace-diff ins').first().innerText(),'+ bar')
    await page.getByRole('button',{name:'取消全选',exact:true}).click()
    assert.equal(await page.getByRole('button',{name:'应用已选择的替换',exact:true}).isDisabled(),true)
    await page.getByRole('checkbox',{name:'选择 1:5',exact:true}).check()
    await page.getByRole('button',{name:'应用已选择的替换',exact:true}).click()
    await page.waitForFunction(()=>window.s.workspace.replaceMessage.includes('成功 1'))
    const request=await page.evaluate(()=>window.f.calls.find(c=>c.command==='apply_workspace_replace').args.request)
    assert.deepEqual(request.selected,[1])
    await page.evaluate(()=>{const w=window.s.workspace;w.replaceFiles=[{path:window.f.root+'/many.txt',version:'1',buffer:false,selected:new Set(),expanded:true,status:'',edits:Array.from({length:1000},(_,i)=>({from:i,to:i+1,line:1,column:i+1,before:'x',insert:'y',context:'x'}))}]})
    assert.equal(await page.locator('.replace-match').count(),1000)
    await page.screenshot({path:`${output}/preview.png`})
  })
  assert.deepEqual(errors,[])
  fs.writeFileSync(`${output}/result.json`,JSON.stringify({ok:true,tests:results,errors},null,2))
} finally { await browser?.close(); await server.close() }
