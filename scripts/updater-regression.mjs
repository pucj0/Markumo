// All installers, networks and native restart calls are fakes. This suite never
// downloads a release or installs/restarts the user's application.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createServer} from 'vite'
const {chromium}=await import(process.env.MARKUMO_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href:'playwright')
const output='test-results/updater';fs.mkdirSync(output,{recursive:true})
fs.writeFileSync(`${output}/index.html`,'<!doctype html><link rel="icon" href="data:,"><div id="app"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import {createApp,h,ref,reactive,markRaw,nextTick} from 'vue';
import {UpdateManager} from '/src/features/shell/updater/UpdateManager.ts';
import {updateState} from '/src/features/shell/updater/UpdateState.ts';
import {prepareInstallation} from '/src/features/shell/updater/prepareInstallation.ts';
import {safeReleaseNotes} from '/src/features/shell/updater/releaseNotes.ts';
import {settingsFrom,defaultSettings,persistedSettings} from '/src/features/shell/editorSettings.ts';
import {SessionWriter,sessionInput,restoreEditorLayout} from '/src/features/shell/launchSession.ts';
import {DocumentManager} from '/src/editor/core/DocumentManager.ts';
import {FileController} from '/src/features/files/FileController.ts';
import UpdateControl from '/src/components/common/UpdateControl.vue';
import UpdatePanel from '/src/components/common/UpdatePanel.vue';
import UpdateConfirm from '/src/components/modals/UpdateConfirm.vue';
import '/src/styles/variables.css';import '/src/styles/reset.css';import '/src/styles/main.css';
const current=ref(null),confirm=ref(null),focus=ref(false),panel=ref(false);
window.f={safeReleaseNotes,settingsFrom,defaultSettings,persistedSettings,SessionWriter,sessionInput,restoreEditorLayout,DocumentManager,FileController,prepareInstallation,
  get item(){return current.value},
  setup(options={}){
    current.value?.manager.dispose();panel.value=false;focus.value=false;
    const events=[],state=reactive({...updateState(),currentVersion:'1.0.2',installSupported:options.supported!==false});
    const hooks={options,events,checks:0,downloads:0,installs:0,restarts:0,closed:0,dirty:[...(options.dirty||[])],locked:false,saves:[],notices:[],reports:0};
    const resource={version:'1.0.3',body:options.notes||'# Improvements\\n\\n- Editor and updates',
      async download(progress){hooks.downloads++;progress({event:'Started',data:{contentLength:options.unknown?undefined:100}});progress({event:'Progress',data:{chunkLength:40}});
        if(options.deferDownload)await new Promise(resolve=>hooks.finishDownload=resolve);
        progress({event:'Progress',data:{chunkLength:60}});progress({event:'Finished'});
        if(options.downloadFailure){options.downloadFailure--;throw Error('offline or signature verification failed')}
      },
      async install(){hooks.installs++;events.push('install');if(options.installFailure){options.installFailure--;throw Error('installer failed')}},
      async close(){hooks.closed++;events.push('close')}
    };
    const preparation={
      status:()=>({dirtyIds:[...hooks.dirty],busy:!!options.busy,composing:!!options.composing}),
      async validateWindows(){hooks.reports++;if(options.otherWindow)throw Error('Other Markumo windows contain unsaved documents')},
      async confirmSave(count){events.push('confirm:'+count);return options.interactive?confirm.value.confirm(count):options.confirm!==false},
      async save(id){hooks.saves.push(id);events.push('save:'+id);if(options.saveFailure||options.saveCancel)return false;hooks.dirty=hooks.dirty.filter(value=>value!==id);if(options.newEdit)hooks.dirty.push('new-edit');return true},
      lock(value){hooks.locked=value;events.push('lock:'+value)},
      async persist(){events.push('persist');if(options.persistFailure)throw Error('disk full');if(options.raceWindow)options.otherWindow=true},
    };
    const manager=markRaw(new UpdateManager(state,{
      async check(){hooks.checks++;if(options.deferCheck)await new Promise(resolve=>hooks.finishCheck=resolve);if(options.checkFailure){options.checkFailure--;throw Error('offline')}return options.noUpdate?null:resource},
      prepare:()=>prepareInstallation(preparation),finishPreparation(){hooks.locked=false},
      async acquire(){events.push('acquire');if(options.leaseFailure)throw Error('another install owns process lease')},async release(){events.push('release')},
      async markPending(version){events.push('mark:'+version)},async clearPending(){events.push('clear')},
      async relaunch(){hooks.restarts++;events.push('restart');if(options.restartFailure)throw Error('restart failed')},
      notify(message){hooks.notices.push(message)}
    }));
    current.value={state,manager,hooks,resource};return current.value;
  },focus(value){focus.value=value},open(value){panel.value=value}
};
createApp({render(){const item=current.value;return item?h('div',[
  !focus.value&&h(UpdateControl,{state:item.state,onOpen:()=>panel.value=true}),
  h('textarea',{'aria-label':'test editor',placeholder:'Edit during download'}),
  panel.value&&h(UpdatePanel,{state:item.state,onClose:()=>panel.value=false,onCheck:()=>item.manager.checkForUpdates(),onDownload:()=>item.manager.downloadUpdate(),onInstall:()=>item.manager.installUpdate(),onRelease:()=>item.hooks.events.push('release-link')}),
  h(UpdateConfirm,{ref:confirm})
]):null}}).mount('#app');
window.f.setup();
`)
const server=await createServer({server:{port:1433,strictPort:true}});await server.listen()
let browser;const passed=[]
try{
  browser=await chromium.launch({headless:true,...(process.env.MARKUMO_CHROME?{executablePath:process.env.MARKUMO_CHROME}:{})})
  const page=await browser.newPage({viewport:{width:1100,height:780}}),errors=[];page.setDefaultTimeout(10000)
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`http://localhost:1433/${output}/index.html`);await page.waitForFunction(()=>window.f)
  const test=async(name,run)=>{await run();passed.push(name);console.log('PASS '+name)}
  const setup=options=>page.evaluate(options=>{window.f.setup(options)},options)
  const check=()=>page.evaluate(()=>window.f.item.manager.checkForUpdates())
  const download=()=>page.evaluate(()=>window.f.item.manager.downloadUpdate())
  const install=()=>page.evaluate(()=>window.f.item.manager.installUpdate())
  const snapshot=()=>page.evaluate(()=>{const {state,hooks}=window.f.item;return {state:{...state},checks:hooks.checks,downloads:hooks.downloads,installs:hooks.installs,restarts:hooks.restarts,closed:hooks.closed,locked:hooks.locked,saves:hooks.saves,events:hooks.events,notices:hooks.notices,dirty:hooks.dirty}})
  await test('no update, check failure and explicit retry',async()=>{
    await setup({noUpdate:true});await check();assert.equal((await snapshot()).state.phase,'up-to-date')
    await setup({checkFailure:1});await check();assert.equal((await snapshot()).state.phase,'error');await check();assert.equal((await snapshot()).state.phase,'available')
  })
  await test('simultaneous automatic/manual/repeated checks coalesce; dispose rejects late resource',async()=>{
    await setup({deferCheck:true})
    await page.evaluate(()=>{const f=window.f,item=f.item;window.checkPromise=item.manager.checkForUpdates();item.manager.checkForUpdates();item.manager.checkForUpdates()})
    assert.equal((await snapshot()).checks,1)
    await page.evaluate(async()=>{window.f.item.manager.dispose();window.f.item.hooks.finishCheck();await window.checkPromise})
    assert.equal((await snapshot()).closed,1)
  })
  await test('dispose before scheduled work never starts a check, and deferred downloads release exactly once',async()=>{
    await setup();await page.evaluate(async()=>{const m=window.f.item.manager;const pending=m.checkForUpdates();m.dispose();await pending});assert.equal((await snapshot()).checks,0)
    await setup({deferDownload:true});await check();await page.evaluate(()=>{window.downloadPromise=window.f.item.manager.downloadUpdate()});await page.waitForFunction(()=>window.f.item.hooks.finishDownload)
    await page.evaluate(async()=>{window.f.item.manager.dispose();window.f.item.manager.dispose();window.f.item.hooks.finishDownload();await window.downloadPromise});assert.equal((await snapshot()).closed,1);assert.equal((await snapshot()).installs,0)
  })
  await test('default off; enabling automatic download on an available update downloads once without installing',async()=>{
    await setup();await check();assert.equal((await snapshot()).downloads,0)
    await page.evaluate(()=>window.f.item.manager.configure({autoCheckUpdates:true,autoDownloadUpdates:true}))
    await page.waitForFunction(()=>window.f.item.state.phase==='downloaded')
    const result=await snapshot();assert.equal(result.downloads,1);assert.equal(result.installs,0);assert.equal(result.restarts,0);assert.equal(result.notices.length,1)
    await check();assert.equal((await snapshot()).state.phase,'downloaded')
  })
  await test('close panel / focus mode unmount preserves download, editor use and native resource',async()=>{
    await setup({deferDownload:true});await check();await page.getByRole('button',{name:'检查更新',exact:true}).click();await page.getByRole('button',{name:'下载更新',exact:true}).click()
    await page.getByRole('button',{name:'稍后',exact:true}).click();await page.evaluate(()=>window.f.focus(true))
    await page.getByRole('textbox',{name:'test editor'}).fill('编辑期间继续输入中文')
    await page.evaluate(()=>window.f.item.hooks.finishDownload());await page.waitForFunction(()=>window.f.item.state.phase==='downloaded')
    const result=await snapshot();assert.equal(result.closed,0);assert.equal(result.installs,0)
    await page.evaluate(()=>window.f.focus(false));await page.getByRole('button',{name:'检查更新',exact:true}).click()
    await page.getByRole('button',{name:'稍后安装',exact:true}).waitFor();assert.equal((await snapshot()).closed,0)
    await page.screenshot({path:`${output}/downloaded.png`})
  })
  await test('unknown download size shows real bytes without percentage; successful promise verifies ready state',async()=>{
    await setup({unknown:true,deferDownload:true});await check();await page.evaluate(()=>{window.downloadPromise=window.f.item.manager.downloadUpdate();window.f.open(true)})
    await page.waitForTimeout(130)
    assert.equal(await page.locator('progress').getAttribute('value'),null)
    assert.doesNotMatch(await page.getByRole('dialog',{name:'应用更新'}).innerText(),/\d+%/)
    await page.screenshot({path:`${output}/download-unknown.png`})
    await page.evaluate(async()=>{window.f.item.hooks.finishDownload();await window.downloadPromise});assert.equal((await snapshot()).state.phase,'downloaded')
  })
  await test('signature/network download failure is retryable and never installs; no tight automatic loop',async()=>{
    await setup({downloadFailure:1});await page.evaluate(()=>window.f.item.manager.configure({autoCheckUpdates:true,autoDownloadUpdates:true}));await check()
    assert.equal((await snapshot()).state.phase,'available');assert.equal((await snapshot()).downloads,1);assert.equal((await snapshot()).installs,0)
    await download();assert.equal((await snapshot()).downloads,2);assert.equal((await snapshot()).state.phase,'downloaded')
  })
  await test('disabling automatic downloads lets the active download finish and disables future scheduling',async()=>{
    await setup({deferDownload:true});await check();await page.evaluate(()=>window.f.item.manager.configure({autoCheckUpdates:true,autoDownloadUpdates:true}));await page.waitForFunction(()=>window.f.item.hooks.finishDownload)
    await page.evaluate(()=>{window.f.item.manager.configure({autoCheckUpdates:true,autoDownloadUpdates:false});window.f.item.hooks.finishDownload()});await page.waitForFunction(()=>window.f.item.state.phase==='downloaded')
    assert.equal((await snapshot()).downloads,1);assert.equal((await snapshot()).installs,0)
  })
  await test('all saved: persist → mark → native install → restart; no premature success',async()=>{
    await setup();await check();await download();await install();const result=await snapshot()
    assert.equal(result.state.phase,'awaiting-restart');assert.equal(result.state.confirmedVersion,'');assert.equal(result.installs,1);assert.equal(result.locked,false)
    assert.ok(result.events.indexOf('persist')<result.events.indexOf('mark:1.0.3'));assert.ok(result.events.indexOf('mark:1.0.3')<result.events.indexOf('install'))
    assert.equal(result.closed,1)
  })
  await test('real save-all confirmation, unnamed/multiple documents and cancel preserve downloaded resource',async()=>{
    await setup({dirty:['named','unnamed','markdown'],interactive:true});await check();await download();await page.evaluate(()=>{window.installPromise=window.f.item.manager.installUpdate()})
    await page.getByRole('dialog',{name:'准备安装更新'}).waitFor();await page.screenshot({path:`${output}/save-confirm.png`});await page.getByRole('button',{name:'取消',exact:true}).click();await page.evaluate(()=>window.installPromise)
    assert.equal((await snapshot()).state.phase,'downloaded');assert.equal((await snapshot()).downloads,1);assert.equal((await snapshot()).installs,0)
    await page.evaluate(()=>{window.installPromise=window.f.item.manager.installUpdate()});await page.getByRole('button',{name:'保存全部并更新'}).click();await page.evaluate(()=>window.installPromise)
    const result=await snapshot();assert.deepEqual(result.saves,['named','unnamed','markdown']);assert.equal(result.installs,1);assert.equal(result.downloads,1)
  })
  for(const [name,options]of Object.entries({saveCancelled:{dirty:['unnamed'],saveCancel:true},saveFailed:{dirty:['named'],saveFailure:true},ime:{composing:true},fileBusy:{busy:true},otherWindows:{otherWindow:true},newEditDuringSave:{dirty:['named'],newEdit:true},persistenceFailed:{persistFailure:true},newWindowDuringPersistence:{raceWindow:true},installLease:{leaseFailure:true}})){
    await test('installation protection: '+name,async()=>{await setup(options);await check();await download();await install();const result=await snapshot();assert.equal(result.installs,0);assert.equal(result.downloads,1);assert.equal(result.state.phase,'downloaded');assert.equal(result.closed,0);assert.equal(result.locked,false)})
  }
  await test('native install failure keeps verified bytes, unlocks editing and permits retry without downloading',async()=>{
    await setup({installFailure:1});await check();await download();await install();assert.equal((await snapshot()).state.phase,'downloaded');assert.ok((await snapshot()).events.includes('clear'));await install();assert.equal((await snapshot()).installs,2);assert.equal((await snapshot()).downloads,1)
  })
  await test('restart failure retries only restart after preparing new edits',async()=>{
    await setup({restartFailure:true});await check();await download();await install();assert.equal((await snapshot()).state.phase,'awaiting-restart')
    await page.evaluate(()=>{window.f.item.hooks.options.restartFailure=false;window.f.item.hooks.dirty=['new draft']});await install();const result=await snapshot();assert.equal(result.installs,1);assert.equal(result.restarts,2);assert.deepEqual(result.saves,['new draft']);assert.equal(result.locked,false)
  })
  await test('duplicate install clicks are serialized during confirmation and never duplicate native installation',async()=>{
    await setup({dirty:['draft'],interactive:true});await check();await download();await page.evaluate(()=>{window.installPromise=window.f.item.manager.installUpdate();window.f.item.manager.installUpdate();window.f.item.manager.installUpdate()})
    await page.getByRole('button',{name:'保存全部并更新'}).click();await page.evaluate(()=>window.installPromise);assert.equal((await snapshot()).installs,1)
  })
  await test('Linux deb is manual-only and never downloads or installs an AppImage',async()=>{
    await setup({supported:false});await check();await download();const result=await snapshot();assert.equal(result.downloads,0);assert.match(result.state.error,/deb/)
  })
  await test('safe Markdown strips executable HTML and links; long notes scroll in both themes',async()=>{
    const safe=await page.evaluate(()=>window.f.safeReleaseNotes('# Notes\n\n<script>alert(1)</script>\n[bad](javascript:alert(1))\n![remote](https://example.com/a.png)\n\n**good**'))
    assert.doesNotMatch(safe,/<script|<img|href="javascript:/);assert.match(safe,/<strong>good/)
    await setup({notes:('# Notes\n\n- Improvement\n').repeat(100)});await check();await page.evaluate(()=>window.f.open(true));const panel=page.getByRole('dialog',{name:'应用更新'});const box=await panel.boundingBox();assert.ok(box.height<710)
    await page.screenshot({path:`${output}/panel-dark.png`});await page.evaluate(()=>document.body.classList.add('light'));await page.screenshot({path:`${output}/panel-light.png`})
  })
  await test('complete release notes link emits once and targets the advertised GitHub version',async()=>{
    await setup();await check();await page.evaluate(()=>window.f.open(true));const link=page.getByRole('link',{name:'查看完整更新日志'});assert.equal(await link.getAttribute('href'),'https://github.com/pucj0/Markumo/releases/tag/v1.0.3');await link.click();assert.equal((await snapshot()).events.filter(event=>event==='release-link').length,1)
  })
  await test('real App settings persist update toggles; complete changelog opens and failures are visible',async()=>{
    const app=await browser.newPage();app.on('pageerror',error=>errors.push(error.message));await app.goto('http://localhost:1433/')
    await app.getByTitle('设置',{exact:true}).click();const auto=app.locator('#settings-update-download');await auto.scrollIntoViewIfNeeded();assert.equal(await auto.isChecked(),false)
    await auto.check();await app.locator('#settings-update-check').uncheck();await app.waitForFunction(()=>{const s=JSON.parse(localStorage.getItem('markumo.settings.v1')||'{}');return s.autoDownloadUpdates===true&&s.autoCheckUpdates===false})
    await app.reload();await app.getByTitle('设置',{exact:true}).click();assert.equal(await app.locator('#settings-update-download').isChecked(),true);assert.equal(await app.locator('#settings-update-check').isChecked(),false)
    await app.locator('#settings-updates').getByRole('button',{name:'检查更新',exact:true}).click();const link=app.getByRole('link',{name:'查看完整更新日志'});await link.waitFor()
    await app.evaluate(()=>{window.openedLinks=[];window.open=(...args)=>{window.openedLinks.push(args);return null}});await link.click();assert.deepEqual(await app.evaluate(()=>window.openedLinks),[['https://github.com/pucj0/Markumo/releases/latest','_blank','noopener,noreferrer']])
    await app.evaluate(()=>window.open=()=>{throw Error('browser unavailable')});await link.click();await app.getByText('无法打开更新日志：browser unavailable',{exact:true}).first().waitFor()
    await app.close()
  })
  await test('real FileController save-all preserves encoding/conflicts and cancels unnamed save safely',async()=>{
    const result=await page.evaluate(async()=>{
      const f=window.f,m=new f.DocumentManager([],async()=>[]);const saves=[];let cancel=true,conflict=false;
      const gateway={release:async()=>{},saveTarget:async()=>cancel?null:{token:'new-token',path:'E:/fixture/new.md',version:null},save:async(token,text,version,encoding,bom)=>{saves.push({token,text,version,encoding,bom});if(conflict)throw Error('external file conflict');return {token,path:token==='named'?'E:/fixture/named.md':'E:/fixture/new.md',name:token+'.md',version:'saved',encoding,bom,eol:'LF',readOnly:false}}};
      const files=new f.FileController(m,gateway,()=>{});files.accept({token:'named',path:'E:/fixture/named.md',name:'named.md',text:'# before',kind:'text',version:'original',encoding:'GB18030',bom:false,eol:'CRLF',readOnly:false});const named=m.activeId;m.dispatch(named,{changes:{from:0,to:m.getState(named).doc.length,insert:'# 修改'}});const draft=m.createUntitled('md');m.dispatch(draft,{changes:{from:0,insert:'# draft'}});
      const services={status:()=>({dirtyIds:m.openedDocuments.filter(d=>d.dirty).map(d=>d.id),busy:false,composing:false}),validateWindows:async()=>{},confirmSave:async()=>true,save:id=>files.save(id),lock:()=>{},persist:async()=>{}};
      const cancelled=await f.prepareInstallation(services),draftRetained=m.metadata(draft).dirty;cancel=false;const saved=await f.prepareInstallation(services);m.dispatch(named,{changes:{from:0,insert:'new'}});conflict=true;const failed=await f.prepareInstallation(services),dirty=m.metadata(named).dirty;
      files.dispose();m.dispose();return {cancelled,draftRetained,saved,failed,dirty,first:saves[0]}
    });assert.equal(result.cancelled,false);assert.equal(result.draftRetained,true);assert.equal(result.saved,true);assert.equal(result.failed,false);assert.equal(result.dirty,true);assert.equal(result.first.encoding,'GB18030');assert.equal(result.first.version,'original')
  })
  await test('existing editor layout restores pane order, active tab and distinct Markdown modes',async()=>{
    assert.deepEqual(await page.evaluate(()=>{
      const f=window.f,m=new f.DocumentManager([],async()=>[]),metadata={token:'doc',path:'E:/fixture/doc.md',name:'doc.md',text:'# Text',kind:'text',version:'v1',encoding:'UTF-8',bom:false,eol:'LF',readOnly:false};m.openFile(metadata);const id=m.activeId;m.setMarkdownMode(id,'source');const secondary=m.splitPane('right');m.setMarkdownMode(id,'live',secondary);const snapshot=f.sessionInput(m,[],{mode:'single',sidebarVisible:false,sidebarWidth:254}).editorLayout;
      const remap=node=>{if(node.type==='split'){remap(node.first);remap(node.second)}else{for(const tab of node.tabs)tab.documentId='E:/fixture/doc.md';if(node.activeId)node.activeId='E:/fixture/doc.md'}};remap(snapshot.root);for(const pane of Object.keys(snapshot.modes))snapshot.modes[pane]={'E:/fixture/doc.md':snapshot.modes[pane].doc};
      const n=new f.DocumentManager([],async()=>[]);n.openFile({...metadata,token:'reopened'});f.restoreEditorLayout(n,snapshot);const value={panes:n.layout.getAllLeafIds(),active:n.activePane,modes:n.layout.getAllLeafIds().map(pane=>n.getMarkdownMode(n.activeId,pane))};m.dispose();n.dispose();return value
    }),{panes:['main','secondary'],active:'secondary',modes:['source','live']})
  })
  await test('preferences default, old migration, validation and round-trip persistence preserve unrelated values',async()=>{
    const result=await page.evaluate(()=>{const f=window.f,a=f.settingsFrom({theme:'dark',fontSize:18}),b=f.settingsFrom({autoCheckUpdates:false,autoDownloadUpdates:true}),c=f.settingsFrom({autoCheckUpdates:'false',autoDownloadUpdates:1});return {old:[a.autoCheckUpdates,a.autoDownloadUpdates,a.theme,a.fontSize],new:[b.autoCheckUpdates,b.autoDownloadUpdates],invalid:[c.autoCheckUpdates,c.autoDownloadUpdates],round:f.settingsFrom(f.persistedSettings(b)).autoDownloadUpdates}})
    assert.deepEqual(result,{old:[true,false,'dark',18],new:[false,true],invalid:[true,false],round:true})
  })
  await test('strict SessionWriter persistence fails closed; subsequent retry can succeed',async()=>{
    assert.deepEqual(await page.evaluate(async()=>{const f=window.f;let bad=true;const writer=new f.SessionWriter(async()=>{if(bad)throw Error('full disk')},()=>{}),input={kind:'single',tabs:[],activeToken:null,layout:{mode:'single',sidebarVisible:false,sidebarWidth:254}};writer.schedule(input);let rejected=false;try{await writer.flush(true)}catch{rejected=true}bad=false;writer.schedule(input);await writer.flush(true);writer.dispose();return {rejected}}),{rejected:true})
  })
  await test('automatic check starts at 10s, repeats at 4h and respects disabled preference/disposal',async()=>{
    await setup({noUpdate:true});await page.clock.install();await page.evaluate(()=>{const m=window.f.item.manager;m.configure({autoCheckUpdates:true,autoDownloadUpdates:false});m.start()});await page.clock.fastForward(9999);assert.equal((await snapshot()).checks,0)
    await page.clock.fastForward(2);assert.equal((await snapshot()).checks,1);await page.clock.fastForward(4*60*60*1000);assert.equal((await snapshot()).checks,2)
    await page.evaluate(()=>window.f.item.manager.configure({autoCheckUpdates:false,autoDownloadUpdates:false}));await page.clock.fastForward(4*60*60*1000);assert.equal((await snapshot()).checks,2)
    await page.evaluate(()=>window.f.item.manager.dispose());await page.clock.resume()
  })
  await test('actual initial automatic timer shares a pending manual check and respects a changed download preference',async()=>{
    await setup({deferCheck:true});await page.evaluate(()=>{const m=window.f.item.manager;m.configure({autoCheckUpdates:true,autoDownloadUpdates:true});m.start();window.checkPromise=m.checkForUpdates()});await page.clock.fastForward(10001);assert.equal((await snapshot()).checks,1)
    await page.evaluate(async()=>{const {manager,hooks}=window.f.item;manager.configure({autoCheckUpdates:true,autoDownloadUpdates:false});hooks.finishCheck();await window.checkPromise});assert.equal((await snapshot()).downloads,0);assert.equal((await snapshot()).state.phase,'available')
  })
  assert.deepEqual(errors,[])
  fs.writeFileSync(`${output}/results.json`,JSON.stringify({passed,errors},null,2));console.log('PASS '+passed.length+' updater checks (mock installers only)')
}finally{await browser?.close();await server.close()}
