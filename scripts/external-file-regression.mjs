import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'
const { chromium } = await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const output = 'test-results/external-files'
fs.mkdirSync(output,{recursive:true})
fs.writeFileSync(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="fixture"></div><script type="module" src="./fixture.js"></script>')
fs.writeFileSync(`${output}/fixture.js`, `
import '/src/styles/reset.css'
import '/src/styles/variables.css'
import {defaultSettings,settingsFrom} from '/src/features/shell/editorSettings.ts'
import {DocumentManager} from '/src/editor/core/DocumentManager.ts'
import {FileController} from '/src/features/files/FileController.ts'
import {AutoSaveController} from '/src/features/files/AutoSaveController.ts'
import {usesCaseInsensitivePaths} from '/src/features/files/pathKey.ts'
import {diffWithinBudget} from '/src/features/files/ExternalFileChangeController.ts'
import {RecoveryController} from '/src/features/recovery/RecoveryController.ts'
import {EditorSelection} from '@codemirror/state'
import {EditorView} from '@codemirror/view'
import {undoDepth,isolateHistory} from '@codemirror/commands'
import {createApp,h,nextTick} from 'vue'
import Banner from '/src/components/layout/ExternalFileBanner.vue'
import Dialogs from '/src/components/modals/ExternalFileDialogs.vue'
import Diff from '/src/components/modals/ExternalFileDiff.vue'
window.f={defaultSettings,settingsFrom,DocumentManager,FileController,AutoSaveController,RecoveryController,usesCaseInsensitivePaths,diffWithinBudget,EditorSelection,EditorView,undoDepth,isolateHistory,createApp,h,nextTick,Banner,Dialogs,Diff}
window.ok=(value,message='assertion failed')=>{if(!value)throw Error(message)}
window.defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
window.flushChecks=async t=>{clearTimeout(t.external.timer);t.external.timer=undefined;await t.external.drain()}
window.flushAuto=async t=>{clearTimeout(t.auto.timer);t.auto.timer=undefined;await t.auto.flush();clearTimeout(t.auto.timer);t.auto.timer=undefined}
window.make=(options={})=>{
 const {recoveryStore=new Map(),...fileOptions}=options
 const manager=new DocumentManager([],async()=>[]), notices=[],released=[],writes=[],subscriptions=[]
 let serial=1, content=options.text??'one\\ntwo\\n', disk={token:'token',path:'E:/isolated/note.'+(options.extension||'txt'),name:'note.'+(options.extension||'txt'),encoding:options.encoding||'UTF-8',bom:options.bom||false,eol:options.eol||'LF',readOnly:false,version:'hash1:8:1',text:content,kind:'text',...fileOptions}
 const t={manager,notices,released,writes,subscriptions,disk,checks:0,reads:0,error:null,readGate:null,checkGate:null,saveGate:null,listener:null}
 const gateway={release:async token=>released.push(token),
 checkExternal:async token=>{t.checks++;if(t.checkImpl)return t.checkImpl(token);const version=t.disk.version,error=t.error;if(t.checkGate)await t.checkGate.promise;if(error)throw error;return version},
 readExternal:async(token,version)=>{t.reads++;const snapshot={...t.disk};if(t.readGate)await t.readGate.promise;if(t.error)throw t.error;if(version!==t.disk.version)throw {code:'conflict',message:'disk changed'};return snapshot},
 watchExternal:async(tokens,generation)=>{subscriptions.push({tokens,generation});return {watcherCount:tokens.length?1:0,directoryCount:tokens.length?1:0,fileCount:tokens.length}},
 listenExternal:async listener=>{t.listener=listener;return ()=>{t.listener=null}},
 saveTarget:async()=>t.target??null,
 save:async(token,text,version,encoding,bom)=>{t.saveCalls=(t.saveCalls||0)+1;if(t.saveGate)await t.saveGate.promise;if(t.saveError)throw t.saveError;if(token==='token'&&version!==t.disk.version)throw {code:'conflict',message:'disk conflict'};writes.push({token,text,version,encoding,bom});const result={...t.disk,token,path:t.target?.path??t.disk.path,name:t.target?'copy.txt':t.disk.name,version:'saved'+(++serial)+':8:'+serial,text,encoding,bom};if(token==='token')t.disk=result;return result}
 }
 const files=new FileController(manager,gateway,message=>notices.push(message)),external=files.external
 files.accept(disk); const id=manager.activeId
 // Real controllers share this controllable persistent transport. Rust atomic
 // semantics are covered separately by native tests, never inferred from Map.set.
 const transport={records:recoveryStore,calls:[],removed:[],fail:false,gate:null,
  summary:r=>({id:r.id,name:r.name,path:r.path,updatedAt:r.updatedAt,charCount:r.text.length,sizeBytes:new TextEncoder().encode(r.text).length,mode:r.mode,panes:r.panes,diskExists:!!r.path,diskChanged:r.diskVersion!==t.disk.version}),
  async list(){return {records:[...recoveryStore.values()].map(r=>this.summary(r)),warnings:[]}},
  async read(id){if(!recoveryStore.has(id))throw Error('missing snapshot');return {...recoveryStore.get(id)}},
  async save(input){this.calls.push({...input});if(this.gate)await this.gate.promise;if(this.fail)throw Error('injected recovery write failure');if(input.id&&!recoveryStore.has(input.id))throw Error('stale update of deleted snapshot');const rid=input.id||crypto.randomUUID().replaceAll('-','');const r={...input,id:rid,schemaVersion:1,updatedAt:Date.now(),charCount:input.text.length,checksum:'controlled transport',diskSize:null,diskModifiedNs:null};recoveryStore.set(rid,r);return {record:this.summary(r),warnings:[]}},
  async remove(id){this.removed.push(id);recoveryStore.delete(id)}}
 const recovery=new RecoveryController(manager,files,transport,message=>notices.push(message),{debounceMs:10})
 files.setSavedHandler(id=>recovery.onSaved(id));external.setRecoveryCheckpoint(id=>recovery.checkpointBeforeReload(id))
 const ready=recovery.start()
 Object.assign(t,{files,external,id,gateway,recovery,transport,ready,edit:(text='local')=>manager.dispatch(id,{changes:{from:manager.getState(id).doc.length,insert:text},annotations:isolateHistory.of('full')}),change:(text='external')=>{t.disk={...t.disk,text,version:'hash'+(++serial)+':'+text.length+':'+serial}},dispose:()=>{recovery.dispose();t.auto?.dispose();t.app?.unmount();files.dispose();manager.dispose();document.querySelector('#fixture').replaceChildren()}})
 return t
}
`)
const server=await createServer({server:{host:'127.0.0.1',port:1491,strictPort:true,hmr:false,watch:null}})
console.log('Starting external-file regression server')
await server.listen()
console.log('External-file regression server ready')
let browser
const results=[], errors=[]
try {
 browser=await chromium.launch({headless:true,executablePath:process.env.MARKUMO_CHROME})
 const page=await browser.newPage({viewport:{width:1100,height:760}})
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`http://127.0.0.1:1491/${output}/index.html`)
 await page.waitForFunction(()=>window.make)
 const test=async(name,fn)=>{let timer;try{await Promise.race([page.evaluate(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timed out: '+name)),20000)})]);results.push(name);console.log('PASS '+name)}finally{clearTimeout(timer)}}
 await test('busy checks park without polling and resume when the workspace operation ends',async()=>{
   const t=make();try{t.files.workspaceBusy=true;t.change('after workspace operation');await t.external.check(t.id);ok(t.checks===0);ok(!t.external.timer,'busy checks must not create polling timers');t.files.workspaceBusy=false;await flushChecks(t);ok(t.manager.getText(t.id)==='after workspace operation');ok(!t.external.blocked(t.id))}finally{t.dispose()}
 })
 await test('a clean reload interrupted by a busy operation resumes safely without a new watcher hint',async()=>{
   const t=make();try{t.change('deferred clean body');t.readGate=defer();const pending=t.external.check(t.id);while(!t.reads)await Promise.resolve();t.files.workspaceBusy=true;t.readGate.resolve();await pending;ok(t.manager.getText(t.id)!=='deferred clean body');ok(t.external.state(t.id).phase==='changed-clean');ok(!t.external.timer);t.files.workspaceBusy=false;await flushChecks(t);ok(t.manager.getText(t.id)==='deferred clean body');ok(!t.external.blocked(t.id))}finally{t.dispose()}
 })
 await test('disabling automatic reload while a read is pending retains the clean buffer and explicit conflict handling',async()=>{
   const t=make();try{const before=t.manager.getText(t.id);t.change('disk opt-out');t.readGate=defer();const pending=t.external.check(t.id);while(!t.reads)await Promise.resolve();t.external.configure(false,false);t.readGate.resolve();await pending;ok(t.manager.getText(t.id)===before,'late disk read ignored auto-reload opt-out');ok(t.external.blocked(t.id));await t.external.check(t.id);ok(t.manager.getText(t.id)===before);await t.external.requestReload(t.id);ok(await t.external.confirmReload());ok(t.manager.getText(t.id)==='disk opt-out')}finally{t.dispose()}
 })
 await test('clean Source reload preserves line/column, mounted pane shells and unrelated focus',async()=>{
   const t=make({text:'a\nsecond\nthird\n'});try{
     const root=document.querySelector('#fixture'),a=document.createElement('div'),b=document.createElement('div'),button=document.createElement('button');root.append(a,b,button);
     t.manager.mountPane(a,t.manager.activePane);const primary=t.manager.activePane;
     t.manager.paneView(primary).dispatch({selection:{anchor:4}});
     const other=t.manager.splitPane('right',primary,t.id);t.manager.mountPane(b,other);t.manager.paneView(other).dispatch({selection:{anchor:10}});
     const first=t.manager.paneView(primary).dom,second=t.manager.paneView(other).dom;button.focus();const active=t.manager.activePane;
     t.change('a much longer header\nsecond\nthird\n');await t.external.check(t.id);
     const state=t.manager.getState(t.id),one=t.manager.paneView(primary).state.selection.main.head,two=t.manager.paneView(other).state.selection.main.head;
     ok(one===state.doc.line(2).from+2,'first pane lost line/column');ok(two===state.doc.line(3).from+1,'second pane lost line/column');
     ok(t.manager.paneView(primary).dom===first&&t.manager.paneView(other).dom===second,'source editor shells were recreated');ok(document.activeElement===button);ok(t.manager.activePane===active);ok(t.manager.openedDocuments.length===1);ok(f.undoDepth(state)===0)
   }finally{t.dispose()}
 })
 await test('a transient clean read failure can recover on a fresh check without polling or notifications',async()=>{
   const t=make();try{t.change('recovered clean disk');t.readGate=defer();const pending=t.external.check(t.id);while(!t.reads)await Promise.resolve();t.error={code:'io',message:'temporary read failure'};t.readGate.resolve();await pending;ok(t.external.state(t.id).phase==='unavailable');ok(!t.external.timer);ok(!t.notices.length);t.error=null;await t.external.check(t.id);ok(t.manager.getText(t.id)==='recovered clean disk');ok(!t.external.blocked(t.id))}finally{t.dispose()}
 })
 await test('Source auto-reload retains the scrolled viewport after asynchronous measurements',async()=>{
   const text=Array.from({length:120},(_,n)=>'line '+n).join('\n'),t=make({text});try{const host=document.createElement('div');document.querySelector('#fixture').append(host);t.manager.mountPane(host,t.manager.activePane);const view=t.manager.activeEditorView;view.dom.style.height='120px';const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await frames();view.scrollDOM.scrollTop=240;await frames();const top=view.scrollDOM.scrollTop;ok(top>0);t.change(text.replace('line 0','a longer header'));await t.external.check(t.id);await frames();ok(Math.abs(view.scrollDOM.scrollTop-top)<2,'reload jumped the scrolled viewport: '+top+' -> '+view.scrollDOM.scrollTop);ok(t.manager.activeEditorView===view)}finally{t.dispose()}
 })
 await test('edits with undo or an explicit keep revoke a deferred clean reload permission',async()=>{
   for(const action of ['edit-undo','keep']){const t=make();try{const before=t.manager.getText(t.id);t.change('deferred disk');t.readGate=defer();const pending=t.external.check(t.id);while(!t.reads)await Promise.resolve();t.files.workspaceBusy=true;t.readGate.resolve();await pending;if(action==='keep')t.external.keep(t.id);else{t.edit();t.manager.command('undo')}ok(t.manager.getText(t.id)===before);t.files.workspaceBusy=false;await flushChecks(t);ok(t.manager.getText(t.id)===before);ok(t.external.blocked(t.id),'ordinary rechecks cleared a confirmed conflict after user intervention')}finally{t.dispose()}}
 })
 await test('clean Markdown Live reload restores focus unless the user focuses another control during remount',async()=>{
   for(const intervene of [false,true]){const t=make({text:'plain paragraph',extension:'md'});let stop;try{
     const host=document.createElement('div');document.querySelector('#fixture').append(host);t.manager.setMarkdownMode(t.id,'live');t.manager.mountPane(host,t.manager.activePane);
     while(!t.manager.liveReady(t.manager.activePane))await new Promise(resolve=>setTimeout(resolve,10));
     t.manager.activeLiveEditor.focus();ok(host.contains(document.activeElement));const pane=t.manager.activePane,button=document.createElement('button');document.querySelector('#fixture').append(button);t.change('fresh paragraph');
     if(intervene)stop=t.manager.subscribe(()=>{if(t.manager.metadata(t.id)?.lastDiskVersion===t.disk.version&&!t.manager.liveReady(pane))button.focus()});
     await t.external.check(t.id);
     while(!t.manager.liveReady(pane))await new Promise(resolve=>setTimeout(resolve,10));
     ok(intervene?document.activeElement===button:host.contains(document.activeElement),'Live reload lost or stole keyboard focus');ok(t.manager.activePane===pane);ok(t.manager.getText(t.id)==='fresh paragraph')
   }finally{stop?.();t.dispose()}}
 })
 await test('P0 manual save during checking accepts native result and ignores late V1, including errors',async()=>{
   for(const reject of [false,true]) {const t=make();try {
     t.edit();const text=t.manager.getText(t.id),depth=f.undoDepth(t.manager.getState(t.id)),gate=defer();
     t.checkImpl=()=>gate.promise;const pending=t.external.check(t.id);
     ok(t.external.state(t.id).phase==='checking');
     const saved=await t.files.save(t.id);ok(saved,'checking must not reject Ctrl+S');
     const version=t.manager.metadata(t.id).lastDiskVersion;
     if(reject)gate.reject({code:'deleted',message:'obsolete missing file'});else gate.resolve('hash1:8:1');
     await pending;ok(!t.external.blocked(t.id),'late V1/error must not lock saved V2');
     ok(t.external.state(t.id).knownVersion===version);ok(t.external.state(t.id).operation===null);
     ok(t.manager.getText(t.id)===text&&f.undoDepth(t.manager.getState(t.id))===depth);ok(!t.notices.length);
     t.checkImpl=null;t.change('real change after V2');t.edit('new edit');await t.external.check(t.id);
     ok(t.external.blocked(t.id));ok(!await t.files.save(t.id));ok(t.writes.length===1);
   } finally {t.dispose()}}
 })
 await test('P0 ten Ctrl+S in source/live/split and shared panes retain canonical text and undo',async()=>{
   for(const mode of ['source','live','split']){const t=make({extension:'md'});try{
     t.manager.setMarkdownMode(t.id,mode);t.manager.splitPane('right',t.manager.activePane,t.id);t.edit();
     const before=t.manager.getText(t.id),depth=f.undoDepth(t.manager.getState(t.id));
     for(let n=0;n<10;n++){const gate=defer();t.checkImpl=()=>gate.promise;const check=t.external.check(t.id);ok(await t.files.save(t.id));gate.resolve('hash1:8:1');await check;ok(!t.external.blocked(t.id))}
     ok(t.writes.length===10);ok(t.manager.openedDocuments.length===1);ok(t.manager.getText(t.id)===before);ok(f.undoDepth(t.manager.getState(t.id))===depth);ok(!t.notices.length);
   }finally{t.dispose()}}
 })
 await test('P0 external content changes during checking or native save are still refused',async()=>{
   for(const duringSave of [false,true]){const t=make();try{
     t.edit();const depth=f.undoDepth(t.manager.getState(t.id));t.checkGate=defer();const check=t.external.check(t.id);
     if(duringSave)t.saveGate=defer();else t.change('external during check');
     const save=t.files.save(t.id);if(duringSave){t.change('external during native save');t.saveGate.resolve()}
     ok(!await save);t.checkGate.resolve();await check;ok(t.external.blocked(t.id));ok(t.external.state(t.id).conflictValid);ok(t.writes.length===0);ok(t.manager.metadata(t.id).dirty);ok(f.undoDepth(t.manager.getState(t.id))===depth);
   }finally{t.dispose()}}
 })
 await test('P0 native I/O and IPC failures permit a second manual attempt',async()=>{
   for(const code of ['permission','read_only','io','busy','file_locked','ipc']){const t=make();try{
     t.edit();t.saveError={code,message:code};ok(!await t.files.save(t.id));ok(!t.external.blocked(t.id));ok(!t.external.state(t.id).conflictValid);
     t.saveError=null;ok(await t.files.save(t.id));ok(t.saveCalls===2);ok(t.external.state(t.id).phase==='normal');ok(t.notices.length===1);
   }finally{t.dispose()}}
 })
 await test('P0 successful baseline is published before deferred or failed recovery bookkeeping',async()=>{
   const t=make();try{t.edit();const gate=defer(),entered=defer();t.files.setSavedHandler(()=>{entered.resolve();return gate.promise});const save=t.files.save(t.id);await entered.promise;
     ok(t.external.state(t.id).knownVersion===t.disk.version);ok(!t.external.blocked(t.id));gate.reject(Error('recovery unavailable'));ok(await save);ok(!t.external.blocked(t.id));ok(!t.manager.metadata(t.id).dirty);
   }finally{t.dispose()}
 })
 await test('P0 autosave parks during check, resumes once and bounds I/O retries with deduplicated notices',async()=>{
   const t=make(),now=Date.now;let time=now();Date.now=()=>time;
   try{t.edit();t.auto=new f.AutoSaveController(t.manager,t.files);t.checkGate=defer();const check=t.external.check(t.id);t.auto.configure(true,0);
     ok(!t.auto.timer,'autosave must await check completion without polling');ok(await t.files.autoSave(t.id)==='skipped');ok(!t.saveCalls);
     t.checkGate.resolve();await check;await flushAuto(t);ok(t.writes.length===1);ok(!t.notices.length);
     t.edit('retry');t.saveError={code:'permission',message:'permission denied'};
     await flushAuto(t);ok(t.auto.failures.get(t.id).retryAt===time+1000);await flushAuto(t);ok(t.saveCalls===2);
     time+=1000;await flushAuto(t);ok(t.auto.failures.get(t.id).retryAt===time+4000);
     time+=4000;await flushAuto(t);ok(t.auto.failures.get(t.id).retryAt===Infinity);for(let n=0;n<10;n++){time+=10000;t.edit('x');await flushAuto(t)}
     ok(t.saveCalls===4);ok(t.notices.length===1);ok(t.manager.metadata(t.id).dirty);ok(!t.external.blocked(t.id));
     t.disk={...t.disk,version:t.disk.version.split(':').slice(0,2).join(':')+':999'};await t.external.check(t.id);await flushAuto(t);ok(t.saveCalls===4,'metadata-only watcher hints must not reset an exhausted failure budget');
     t.saveError=null;ok(await t.files.save(t.id));t.edit('recovered');await flushAuto(t);ok(t.writes.length===3);ok(!t.manager.metadata(t.id).dirty);
   }finally{Date.now=now;t.dispose()}
 })
 await test('P0 own-save watcher burst and focus check coalesce; a hint during a read is retained',async()=>{
   const t=make();try{t.external.configure(true);await t.external.start();await flushChecks(t);t.edit();
     const gate=defer();t.checkImpl=()=>gate.promise;t.external.focus(10000);const check=t.external.check(t.id);ok(await t.files.save(t.id));gate.resolve('hash1:8:1');await check;t.checkImpl=null;
     const generation=t.subscriptions.at(-1).generation,before=t.checks;
     for(let n=0;n<100;n++)t.listener({generation,tokens:['token']});await flushChecks(t);
     ok(t.checks===before+1,'100 own-write hints should cost one hash read');ok(!t.external.blocked(t.id));ok(!t.notices.length);
     t.edit('dirty');t.checkGate=defer();const running=t.external.check(t.id);t.change('real external change');
     for(let n=0;n<100;n++)t.listener({generation,tokens:['token']});
     t.checkGate.resolve();await running;t.checkGate=null;await flushChecks(t);ok(t.external.blocked(t.id));ok(!await t.files.save(t.id));ok(t.writes.length===1);
   }finally{t.dispose()}
 })
 await test('P0 confirmed conflicts survive reads, disk revert, undo, errors and monitor toggles',async()=>{
   const t=make();try{const original={...t.disk};t.edit();t.change();await t.external.check(t.id);t.disk=original;await t.external.check(t.id);ok(t.external.blocked(t.id));
     t.error={code:'io',message:'temporary'};await t.external.check(t.id);ok(t.external.blocked(t.id));t.error=null;t.manager.command('undo');await t.external.check(t.id);ok(t.external.blocked(t.id));
     t.external.configure(false);t.external.focus(20000);ok(!await t.files.save(t.id));ok(!t.writes.length);
   }finally{t.dispose()}
 })
 await test('P0 save-as, close/reopen and late rejected checks cannot affect the new capability lifetime',async()=>{
   const t=make();try{t.edit();const gate=defer();t.checkImpl=()=>gate.promise;const check=t.external.check(t.id);ok(await t.files.save(t.id));
     t.target={token:'copy',path:'E:/isolated/copy.txt',version:null};ok(await t.files.save(t.id,true));ok(t.manager.metadata(t.id).fileToken==='copy');ok(t.released.includes('token'));
     t.files.close(t.id,true);t.checkImpl=null;t.files.accept({...t.disk,token:'copy',path:t.target.path});const reopened=t.manager.activeId;
     gate.reject({code:'deleted',message:'late old file'});await check;ok(t.external.state(reopened).phase==='normal');ok(!t.external.blocked(reopened));ok(!t.external.state(t.id));
   }finally{t.dispose()}
 })
 await test('P0 reload/cancel and recovery errors without disk evidence never manufacture a conflict',async()=>{
   const t=make();try{t.edit();await t.external.requestReload(t.id);ok(t.external.resolving(t.id));ok(!await t.files.save(t.id));ok(!await t.files.save(t.id,true));t.external.cancelReload();ok(!t.external.blocked(t.id));
     await t.external.requestReload(t.id);t.external.setRecoveryCheckpoint(async()=>false);ok(!await t.external.confirmReload());ok(!t.external.blocked(t.id));ok(await t.files.save(t.id));
   }finally{t.dispose()}
 })
 await test('P0 large Markdown checks are single-read and do not delay a manual native save',async()=>{
   const t=make({extension:'md',text:'# large\\n'+'内容\\n'.repeat(300000)});try{t.edit();const gate=defer();t.checkImpl=()=>gate.promise;const check=t.external.check(t.id);ok(await t.files.save(t.id));gate.resolve('hash1:8:1');await check;t.checkImpl=null;const before=t.checks;await t.external.check(t.id);ok(t.checks===before+1);ok(!t.external.blocked(t.id));ok(!t.notices.length)}finally{t.dispose()}
 })
 await test('P1 checking has no warning/banner/Toast; transient errors accurately allow native save',async()=>{
   const t=make();try{t.app=f.createApp({render:()=>f.h(f.Banner,{files:t.files,id:t.id})});t.app.mount('#fixture');t.edit();
     t.checkGate=defer();t.error={code:'io',message:'temporary read failure'};const check=t.external.check(t.id);await f.nextTick();ok(!document.querySelector('.external-banner'));t.edit('safe input');
     t.checkGate.resolve();await check;await f.nextTick();const banner=document.querySelector('.external-banner');ok(banner.textContent.includes('磁盘检查暂时失败'));ok(banner.textContent.includes('temporary read failure'));ok(!banner.textContent.includes('文件已在外部修改'));ok(!t.notices.length);
     ok(await t.files.save(t.id));await f.nextTick();ok(!document.querySelector('.external-banner'));ok(!t.notices.length);
   }finally{t.dispose()}
 })
 await test('P1 cancelling an obsolete check frees the shared queue before its IPC settles',async()=>{
   const t=make();try{const second={...t.disk,token:'second',path:'E:/isolated/second.txt',name:'second.txt'};t.files.accept(second);const other=t.manager.activeId;
     t.edit();const gate=defer();t.checkImpl=token=>token==='token'?gate.promise:Promise.resolve(second.version);
     t.external.checkAll();const drain=flushChecks(t);ok(t.external.checking(t.id));ok(await t.files.save(t.id));await drain;
     ok(t.external.state(other).checkedAt>0);ok(!t.external.checking(t.id));gate.reject(Error('old IPC error'));
   }finally{t.dispose()}
 })
 await test('P1 an unstable writer is a bounded monitoring failure, and reload cancellation keeps newly confirmed changes',async()=>{
   const t=make();try{t.edit();let n=0;t.checkImpl=async()=> 'changing:'+ ++n;await t.external.requestReload(t.id);ok(n===4);ok(!t.external.blocked(t.id));ok(t.external.state(t.id).phase==='unavailable');
     t.checkImpl=null;ok(await t.files.save(t.id));t.change('new external version');await t.external.requestReload(t.id);t.external.cancelReload();ok(t.external.blocked(t.id));ok(!await t.files.save(t.id));ok(t.writes.length===1);
   }finally{t.dispose()}
 })
 await test('P1 persistent banner titles and action gates follow check/reload/delete transitions',async()=>{
   const t=make();try{t.edit();t.change();await t.external.check(t.id);t.app=f.createApp({render:()=>f.h(f.Banner,{files:t.files,id:t.id})});t.app.mount('#fixture');
     t.checkGate=defer();const check=t.external.check(t.id);await f.nextTick();ok(document.querySelector('.actions button').disabled);t.checkGate.resolve();await check;await f.nextTick();ok(!document.querySelector('.actions button').disabled);
     t.error={code:'deleted',message:'missing'};await t.external.check(t.id);await f.nextTick();ok(document.querySelector('strong').textContent==='原文件已被删除或移动');ok(t.external.blocked(t.id));
   }finally{t.dispose()}
 })
 await test('P1 closing during an obsolete auto-reload read releases the queue before late read rejection',async()=>{
   const t=make();try{const second={...t.disk,token:'second',path:'E:/isolated/second.txt',name:'second.txt'};t.files.accept(second);const other=t.manager.activeId;t.change('external clean reload');
     t.readGate=defer();t.checkImpl=async token=>token==='token'?t.disk.version:second.version;t.external.checkAll();const drain=flushChecks(t);
     for(let n=0;n<20&&t.reads===0;n++)await Promise.resolve();ok(t.reads===1);t.files.close(t.id,true);await drain;
     ok(!t.external.state(t.id));ok(t.external.state(other).checkedAt>0);t.readGate.reject(Error('late disk read failure'));
   }finally{t.dispose()}
 })
 await test('P1 alternating automatic errors notify once per error until a successful save',async()=>{
   const t=make();try{t.edit();for(const code of ['permission','busy','permission']){t.saveError={code,message:code};ok(await t.files.autoSave(t.id)==='failed')}
     ok(t.notices.length===2);t.saveError=null;ok(await t.files.save(t.id));t.edit('new failure episode');t.saveError={code:'permission',message:'permission'};ok(await t.files.autoSave(t.id)==='failed');ok(t.notices.length===3);
   }finally{t.dispose()}
 })
 await test('01 clean file reloads without save; retains source text and baseline',async()=>{const t=make();try{t.change('新内容\r\nnext');await t.external.check(t.id);ok(t.manager.getText(t.id)==='新内容\nnext');ok(t.manager.saveSnapshot(t.id).text==='新内容\r\nnext');ok(!t.manager.metadata(t.id).dirty);ok(t.external.state(t.id).phase==='normal');ok(t.writes.length===0)}finally{t.dispose()}})
 await test('02 dirty conflict persists across editing, undo, pane focus, setting toggles and keep-current',async()=>{const t=make();try{t.edit();const original=t.manager.getText(t.id),depth=f.undoDepth(t.manager.getState(t.id)),baseline=t.manager.metadata(t.id).lastDiskVersion;t.change();await t.external.check(t.id);t.external.keep(t.id);ok(await t.files.save(t.id)===false);ok(t.writes.length===0);ok(t.manager.getText(t.id)===original);ok(f.undoDepth(t.manager.getState(t.id))===depth);ok(t.manager.metadata(t.id).lastDiskVersion===baseline);t.edit('more');t.external.configure(false);t.external.configure(true);ok(t.external.blocked(t.id));t.manager.command('undo');ok(t.external.blocked(t.id))}finally{t.dispose()}})
 await test('03 native hint proactively checks; coalesces bursts; focus catches missed events and is throttled',async()=>{const t=make();try{t.external.configure(true);await t.external.start();await t.external.check(t.id);window.eventTest=t;t.change('event');const generation=t.subscriptions.at(-1).generation;for(let n=0;n<100;n++)t.listener({generation,tokens:['token']})}catch(e){t.dispose();throw e}})
 await page.waitForFunction(()=>window.eventTest.manager.getText(window.eventTest.id)==='event')
 await page.evaluate(()=>{const t=window.eventTest;t.change('focus');t.external.focus(10000);const before=t.checks;t.external.focus(10001);ok(t.checks===before)})
 await page.waitForFunction(()=>window.eventTest.manager.getText(window.eventTest.id)==='focus')
 const eventMetrics=await page.evaluate(()=>{const t=window.eventTest;const r={checks:t.checks,reads:t.reads,files:t.external.watchStatus.value.fileCount};t.dispose();return r})
 assert(eventMetrics.checks<20,'duplicate native hints must coalesce')
 await test('04 own saves and metadata-only changes do not create conflict',async()=>{const t=make();try{t.edit();ok(await t.files.save(t.id));await t.external.check(t.id);ok(!t.external.blocked(t.id));const baseline=t.manager.metadata(t.id).lastDiskVersion;t.disk={...t.disk,version:baseline.split(':').slice(0,2).join(':')+':999'};await t.external.check(t.id);ok(!t.external.blocked(t.id));ok(t.manager.metadata(t.id).lastDiskVersion===t.disk.version)}finally{t.dispose()}})
 await test('05 unknown external write still fails conditional save without watcher',async()=>{const t=make();try{t.edit();t.change();ok(!await t.files.save(t.id));ok(t.writes.length===0);ok(t.external.blocked(t.id));ok(t.manager.metadata(t.id).dirty)}finally{t.dispose()}})
 await test('06 compare reads disk and canonical edit snapshots without changing baseline/history; marks stale after B',async()=>{const t=make({text:'# 标题\r\n```js\r\nlet x=1\r\n```',extension:'md',eol:'CRLF',bom:true});try{t.edit('local');t.change('磁盘 A');await t.external.check(t.id);const baseline=t.manager.metadata(t.id).lastDiskVersion,depth=f.undoDepth(t.manager.getState(t.id));await t.external.compare(t.id);ok(t.external.diff.value.disk==='磁盘 A');ok(t.external.diff.value.local.includes('```js'));ok(t.manager.metadata(t.id).lastDiskVersion===baseline);ok(f.undoDepth(t.manager.getState(t.id))===depth);t.change('磁盘 B');await t.external.check(t.id);ok(t.external.diffStale());await t.external.compare(t.id);ok(t.external.diff.value.disk==='磁盘 B');t.edit('new');ok(t.external.diffStale())}finally{t.dispose()}})
 await test('07 load requires confirmation; cancellation preserves dirty buffer and undo',async()=>{const t=make();try{t.edit();t.change();await t.external.check(t.id);const before=t.manager.getText(t.id);await t.external.requestReload(t.id);ok(t.external.confirmation.value.dirty);ok(t.manager.getText(t.id)===before);t.external.cancelReload();ok(t.manager.getText(t.id)===before);ok(t.external.blocked(t.id))}finally{t.dispose()}})
 await test('08 disk changed after confirmation invalidates intent',async()=>{const t=make();try{t.edit();t.change('A');await t.external.check(t.id);await t.external.requestReload(t.id);t.change('B');ok(!await t.external.confirmReload());ok(t.manager.getText(t.id).includes('local'));ok(t.external.blocked(t.id))}finally{t.dispose()}})
 await test('09 edit after confirmation or during disk read cancels overwrite',async()=>{const t=make();try{t.edit();t.change('A');await t.external.check(t.id);await t.external.requestReload(t.id);t.edit('after confirmation');ok(!await t.external.confirmReload());await t.external.requestReload(t.id);t.readGate=defer();const pending=t.external.confirmReload();await Promise.resolve();await Promise.resolve();t.edit('during read');t.readGate.resolve();ok(!await pending);ok(t.manager.getText(t.id).includes('during read'));ok(t.external.blocked(t.id))}finally{t.dispose()}})
 await test('10 clean check/read racing new input cannot replace local text',async()=>{const t=make();try{t.change();t.readGate=defer();const pending=t.external.check(t.id);window.race=t;window.racePending=pending}catch(e){t.dispose();throw e}})
 await page.waitForFunction(()=>window.race.reads===1)
 await page.evaluate(async()=>{const t=window.race;try{t.edit();t.readGate.resolve();await window.racePending;ok(t.manager.getText(t.id).includes('local'));ok(t.external.blocked(t.id))}finally{t.dispose()}})
 await test('11 save-as uses current buffer, preserves encoding/BOM, changes binding, retains later edits',async()=>{const t=make({encoding:'UTF-16LE',bom:true,eol:'Mixed'});try{t.edit();t.change();await t.external.check(t.id);t.target={token:'new',path:'E:/isolated/copy.txt',version:null};t.saveGate=defer();const pending=t.files.save(t.id,true);await Promise.resolve();t.edit('later');t.saveGate.resolve();ok(!await pending);ok(t.writes.length===1);ok(!t.writes[0].text.includes('later'));ok(t.writes[0].encoding==='UTF-16LE'&&t.writes[0].bom);ok(t.manager.metadata(t.id).dirty);ok(t.manager.metadata(t.id).fileToken==='new');ok(!t.external.blocked(t.id));ok(t.released.includes('token'))}finally{t.dispose()}})
 await test('12 save-as to original path rejected and temporary target capability released',async()=>{const t=make();try{t.edit();t.change();await t.external.check(t.id);const path=t.disk.path.replaceAll('/','\\');t.target={token:'extra',path:f.usesCaseInsensitivePaths()?path.toUpperCase():path,version:t.disk.version};ok(!await t.files.save(t.id,true));ok(!t.writes.length);ok(t.released.includes('extra'));ok(t.external.blocked(t.id))}finally{t.dispose()}})
 await test('13 autosave centrally pauses conflict through edits and disable/re-enable; unrelated files save',async()=>{const t=make();try{t.edit();t.change();await t.external.check(t.id);t.auto=new f.AutoSaveController(t.manager,t.files);t.auto.configure(true,0);t.edit('x');ok(await t.files.autoSave(t.id)==='skipped');t.auto.configure(false,0);t.auto.configure(true,0);ok(t.external.blocked(t.id));await t.external.requestReload(t.id);ok(await t.external.confirmReload());ok(!t.external.blocked(t.id));t.edit('after resolved');window.autoResume=t}catch(e){t.dispose();throw e}})
 await page.waitForFunction(()=>window.autoResume.writes.length===1&&!window.autoResume.manager.metadata(window.autoResume.id).dirty)
 await page.evaluate(()=>window.autoResume.dispose())
 await test('14 delete/rename retains dirty text; compare unavailable; recreated path can reload',async()=>{const t=make();try{t.edit();const before=t.manager.getText(t.id);t.error={code:'deleted',message:'missing'};await t.external.check(t.id);ok(t.external.state(t.id).phase==='deleted');await t.external.compare(t.id);ok(t.external.diff.value===null);ok(t.manager.getText(t.id)===before);t.error=null;t.change('recreated');await t.external.check(t.id);ok(t.external.state(t.id).phase==='conflict');await t.external.requestReload(t.id);ok(await t.external.confirmReload());ok(t.manager.getText(t.id)==='recreated')}finally{t.dispose()}})
 await test('15 temporary monitoring failures retain text without inventing persistent conflicts',async()=>{for(const code of ['permission','encoding','io','busy','file_locked','conflict','ipc']){const t=make();try{t.edit();const before=t.manager.getText(t.id),depth=f.undoDepth(t.manager.getState(t.id));t.error={code,message:code};await t.external.check(t.id);ok(t.external.state(t.id).phase==='unavailable');ok(!t.external.state(t.id).conflictValid);ok(!t.external.blocked(t.id));ok(!t.notices.length);t.error=null;await t.external.check(t.id);ok(t.external.state(t.id).phase==='normal');ok(await t.files.save(t.id));ok(t.manager.getText(t.id)===before);ok(f.undoDepth(t.manager.getState(t.id))===depth)}finally{t.dispose()}}})
 await test('16 source/live/split keep Markdown source, mode and per-pane selection; reset discarded undo',async()=>{for(const mode of ['source','live','split']){const t=make({extension:'md',text:'# 标题\n```mermaid\ngraph TD; A-->B\n```\n$$x^2$$\n![a](./a.png)'});try{t.manager.setMarkdownMode(t.id,mode);const other=t.manager.splitPane('right',t.manager.activePane,t.id);t.manager.setMarkdownMode(t.id,'source',other);t.change(t.disk.text+'\nexternal');await t.external.check(t.id);ok(t.manager.getMarkdownMode(t.id,t.manager.layout.getPrimaryPane().id)===mode);ok(t.manager.getMarkdownMode(t.id,other)==='source');ok(t.manager.getText(t.id).includes('```mermaid'));ok(t.manager.getText(t.id).includes('./a.png'));ok(t.external.state(t.id).phase==='normal');ok(t.manager.openedDocuments.length===1);ok(f.undoDepth(t.manager.getState(t.id))===0)}finally{t.dispose()}}})
 await test('17 stale checks after close or path binding change never recreate/overwrite documents',async()=>{const t=make();try{t.change();t.checkGate=defer();const pending=t.external.check(t.id);t.files.close(t.id,true);t.checkGate.resolve();await pending;ok(!t.manager.metadata(t.id));ok(!t.external.state(t.id))}finally{t.dispose()}})
 await test('18 old workspace generation events and disposed listener ignored; subscriptions cleaned',async()=>{const t=make();t.external.configure(true);await t.external.start();const generation=t.subscriptions.at(-1).generation;t.external.configure(false);const before=t.checks;t.external.hint({generation,tokens:['token']});ok(t.checks===before);t.dispose();await Promise.resolve();await Promise.resolve();ok(t.listener===null);ok(t.external.diff.value===null);ok(t.external.watchStatus.value?.fileCount===1||t.external.watchStatus.value===null)})
 await test('19 large diff budget bounds Unicode/line workloads',()=>{ok(!f.diffWithinBudget('中'.repeat(256*1024),'x'));ok(!f.diffWithinBudget('\n'.repeat(20001),'x'));ok(f.diffWithinBudget('中文😀\r\n','中文\n'))})
 await test('20 media/ClassFile/Hex never use text diff or accidental binary save',async()=>{for(const kind of ['image','pdf','javaClass']){const t=make({kind,encoding:'Binary',readOnly:true,media:{byteLength:8,mime:kind==='pdf'?'application/pdf':'image/png',format:'PNG'},classInfo:{className:'A',superName:null,majorVersion:52,minorVersion:0,accessFlags:0,byteLength:8,constantPoolCount:0,constants:[],fieldsCount:0,methodsCount:0,fields:[],methods:[],interfaces:[],displayTruncated:false}});try{await t.external.compare(t.id);ok(t.external.diff.value===null);ok(!await t.files.save(t.id));ok(!t.writes.length)}finally{t.dispose()}}const t=make({encoding:'Hex',text:'CA FE'});try{await t.external.compare(t.id);ok(t.external.diff.value===null)}finally{t.dispose()}})
 await test('21 recovery checkpoint must succeed before destructive reload and is retained afterwards',async()=>{const t=make();let calls=0;try{t.edit();t.change();await t.external.check(t.id);t.external.setRecoveryCheckpoint(async()=>{calls++;return false});await t.external.requestReload(t.id);ok(!await t.external.confirmReload());ok(t.manager.getText(t.id).includes('local'));t.external.setRecoveryCheckpoint(async()=>{calls++;return true});await t.external.requestReload(t.id);ok(await t.external.confirmReload());ok(calls===2);ok(!t.manager.metadata(t.id).dirty)}finally{t.dispose()}})
 await test('22 snapshot controller writes and detaches durable pre-reload recovery instead of deleting it',async()=>{const t=make();let saved=[],removed=[];const recovery=new f.RecoveryController(t.manager,t.files,{list:async()=>({records:[],warnings:[]}),save:async input=>{saved.push(input);return {record:{id:'durable'},warnings:[]}},remove:async id=>removed.push(id)},()=>{});try{await recovery.start();t.edit();ok(await recovery.checkpointBeforeReload(t.id));t.manager.reloadFile(t.id,{...t.disk,text:'new'},true);await recovery.onSaved(t.id);ok(saved[0].text.includes('local'));ok(!removed.length)}finally{recovery.dispose();t.dispose()}})
 await test('23 clean reload disabled setting keeps buffer and explicit reload remains available',async()=>{const t=make();try{t.external.configure(false,false);t.change('manual reload');await t.external.check(t.id);ok(t.manager.getText(t.id)!=='manual reload');ok(t.external.state(t.id).phase==='changed-clean');await t.external.requestReload(t.id);ok(await t.external.confirmReload());ok(t.manager.getText(t.id)==='manual reload')}finally{t.dispose()}})
 await test('24 unrelated documents save while a conflict stays blocked',async()=>{const t=make();try{t.edit();t.change();await t.external.check(t.id);t.files.accept({...t.disk,token:'other',path:'E:/other/second.txt',name:'second.txt',text:'safe'});const other=t.manager.activeId;t.manager.dispatch(other,{changes:{from:4,insert:' saved'}});ok(await t.files.autoSave(other)==='saved');ok(t.external.blocked(t.id));ok(t.writes[0].token==='other')}finally{t.dispose()}})
 await test('25 reload preserves reverse multi-cursor ranges in both mounted panes',async()=>{const t=make({text:'one\ntwo\nthree\n'});try{const root=document.querySelector('#fixture'),a=document.createElement('div'),b=document.createElement('div');a.style.height=b.style.height='200px';root.append(a,b);t.manager.mountPane(a,t.manager.activePane);t.manager.dispatch(t.id,{selection:f.EditorSelection.create([f.EditorSelection.range(5,1),f.EditorSelection.cursor(9)],1)});const other=t.manager.splitPane('right',t.manager.activePane,t.id);t.manager.mountPane(b,other);const before=t.manager.getState(t.id).selection.toJSON();t.change('one\ntwo\nthree\nfour\n');await t.external.check(t.id);const after=t.manager.getState(t.id).selection.toJSON();ok(JSON.stringify(after)===JSON.stringify(before),'multi-cursor selection changed');ok(root.querySelectorAll('.cm-content').length===2)}finally{t.dispose()}})
 await test('26 IME composition parks without polling and resumes after composition ends',async()=>{const t=make();try{const host=document.createElement('div');document.querySelector('#fixture').append(host);t.manager.mountPane(host,t.manager.activePane);const content=host.querySelector('.cm-content');content.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'中'}));ok(t.manager.isComposing,'IME guard not entered');t.change('external during IME');const before=t.manager.getText(t.id);await t.external.check(t.id);ok(t.manager.getText(t.id)===before);ok(!t.external.timer);ok(await t.files.autoSave(t.id)==='skipped');content.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中'}));await Promise.resolve();ok(!t.manager.isComposing);ok(t.external.timer,'composition end did not wake the check queue');await flushChecks(t);ok(t.manager.getText(t.id)==='external during IME')}finally{t.dispose()}})
 await test('27 settings default on, migrate safely, preserve explicit opt-outs',()=>{const defaults=f.defaultSettings();ok(defaults.externalFileMonitoring&&defaults.autoReloadExternal);const settings=f.settingsFrom({...defaults,externalFileMonitoring:false,autoReloadExternal:false});ok(!settings.externalFileMonitoring&&!settings.autoReloadExternal)})
 await test('28 monitoring failures are visible and do not disable conditional saves',async()=>{const t=make();try{t.gateway.watchExternal=async()=>{throw Error('injected watcher failure')};t.external.configure(true);await t.external.start();ok(t.external.monitoringError.value.includes('injected watcher failure'));t.change();t.external.focus(99999);window.monitorFallback=t}catch(e){t.dispose();throw e}})
 await page.waitForFunction(()=>window.monitorFallback.manager.getText(window.monitorFallback.id)==='external')
 await page.evaluate(()=>window.monitorFallback.dispose())
 await test('30 disabled monitoring hides subscription errors and restores honest fallback status when enabled',async()=>{const t=make();try{t.gateway.listenExternal=async()=>{throw Error('listener unavailable')};await t.external.start();ok(t.external.monitoringError.value===null);t.external.configure(true);ok(t.external.monitoringError.value);t.external.configure(false);ok(t.external.monitoringError.value===null);t.external.configure(true);ok(t.external.monitoringError.value)}finally{t.dispose()}})
 await test('23 persistent banner, four actions, safe confirmation focus and keep-current affordance render',async()=>{const t=make();t.edit();t.change();await t.external.check(t.id);t.app=f.createApp({render:()=>f.h('div',[f.h(f.Banner,{files:t.files,id:t.id}),f.h(f.Dialogs,{files:t.files})])});t.app.mount('#fixture');window.ui=t})
 await page.getByRole('button',{name:'保留当前',exact:true}).click()
 await page.getByRole('button',{name:/查看处理选项/}).click()
 await page.getByRole('button',{name:'加载磁盘',exact:true}).click()
 await page.getByRole('dialog').waitFor()
 assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'取消')
 await page.getByRole('button',{name:'取消',exact:true}).click()
 await page.getByRole('button',{name:'比较差异',exact:true}).click()
 await page.getByRole('region',{name:'文件差异比较'}).waitFor()
 assert.equal(await page.locator('.external-diff .cm-editor').count(),2)
 assert.equal(await page.locator('.external-diff [contenteditable=true]').count(),0)
 assert.match(await page.locator('.external-diff .sources').textContent(),/磁盘文件.*当前编辑内容/)
 await page.screenshot({path:`${output}/conflict-diff-light.png`})
 await page.evaluate(()=>{document.body.classList.add('light')})
 await page.waitForFunction(()=>document.querySelector('.external-diff')?.querySelectorAll('.cm-editor').length===2)
 assert.equal(await page.locator('.external-diff').evaluate(element=>getComputedStyle(element).color),await page.locator('body').evaluate(element=>getComputedStyle(element).color),'Light diff labels must use the app text color')
 await page.screenshot({path:`${output}/conflict-diff-theme.png`})
 await page.evaluate(async()=>{const t=window.ui,gap=Array.from({length:20},(_,n)=>'unchanged '+n).join('\n'),local='local first\n'+gap+'\nlocal middle\n'+gap+'\nlocal last\n',disk=local.replaceAll('local','disk');t.manager.dispatch(t.id,{changes:{from:0,to:t.manager.getState(t.id).doc.length,insert:local}});t.change(disk);await t.external.check(t.id);await t.external.compare(t.id);window.uiExpectedLast=disk.indexOf('disk last')})
 await page.waitForFunction(()=>document.querySelector('.external-diff nav span')?.textContent.includes('3 处差异'))
 await page.getByRole('button',{name:'上一个变化',exact:true}).click()
 assert.equal(await page.evaluate(()=>f.EditorView.findFromDOM(document.querySelector('.external-diff .cm-editor')).state.selection.main.head),await page.evaluate(()=>window.uiExpectedLast),'first previous-difference navigation must select the last change')
 await page.getByRole('button',{name:'关闭比较并返回编辑器'}).click()
 await page.evaluate(()=>window.ui.dispose())
 await test('24 a failed recovery snapshot write blocks the destructive disk reload',async()=>{const t=make();const recovery=new f.RecoveryController(t.manager,t.files,{list:async()=>({records:[],warnings:[]}),read:async()=>{throw Error('unused')},save:async()=>{throw Error('injected snapshot write failure')},remove:async()=>{}},()=>{},{debounceMs:15});try{t.external.setRecoveryCheckpoint(id=>recovery.checkpointBeforeReload(id));await recovery.start();t.edit();t.change();await t.external.check(t.id);await t.external.requestReload(t.id);ok(!await t.external.confirmReload(),'failed checkpoint must not reload');ok(t.manager.getText(t.id).includes('local'),'dirty buffer was discarded');ok(t.manager.metadata(t.id).dirty);ok((recovery.lastError.value||'').includes('injected snapshot write failure'))}finally{recovery.dispose();t.dispose()}})
 await test('24 real recovery + external reload: exact A/B/C under one ID, ordinary save and restart retain the unclaimed checkpoint',async()=>{
  const store=new Map(),t=make({recoveryStore:store});let restarted
  try{
   await t.ready
   let rid,expected
   for(const text of ['A','B','C']){t.edit(text);expected=t.manager.getText(t.id);await t.recovery.flushForClose();const r=[...store.values()][0];if(!rid)rid=r.id;ok(r.id===rid&&r.text===expected&&store.size===1,'continuous update must persist the exact latest body')}
   t.change('external disk');await t.external.check(t.id);await t.external.requestReload(t.id);ok(await t.external.confirmReload(),'real checkpoint must permit reload')
   ok(t.manager.getText(t.id)==='external disk'&&!t.manager.metadata(t.id).dirty)
   ok(t.recovery.records.value.some(r=>r.id===rid),'detached checkpoint must be visible immediately')
   t.recovery.close();await t.recovery.reload();ok(store.get(rid).text===expected)
   t.edit(' saved B');await t.recovery.flushForClose();ok(store.size===2,'ordinary editing must own a new snapshot')
   ok(await t.files.save(t.id));ok(store.size===1&&store.get(rid).text===expected,'ordinary save deleted checkpoint')
   const disk={...t.disk};t.dispose()
   restarted=make({...disk,recoveryStore:store});await restarted.ready
   const listed=restarted.recovery.records.value.find(r=>r.id===rid);ok(listed,'checkpoint lost across restart')
   ok(await restarted.recovery.restore(listed));const draft=restarted.manager.activeDocument
   ok(!draft.path&&restarted.manager.getText(draft.id)===expected,'changed original must restore exact old body to independent draft')
   ok(restarted.manager.getText(restarted.id)===disk.text,'restore changed original B')
   await restarted.recovery.open();await restarted.recovery.discardDocument(draft.id);ok(!store.has(rid),'explicit document discard must remove its claimed snapshot')
  }finally{if(restarted)restarted.dispose();else t.dispose()}
 })
 await test('25 a failed forced checkpoint cannot reuse a previous successful same-Text receipt',async()=>{
  const t=make();try{await t.ready;t.edit(' A');await t.recovery.flushForClose();const r=[...t.transport.records.values()][0],before=JSON.stringify(r),local=t.manager.getText(t.id),depth=f.undoDepth(t.manager.getState(t.id));t.transport.fail=true;t.change('external');await t.external.check(t.id);await t.external.requestReload(t.id);ok(!await t.external.confirmReload(),'failed current write must block destructive reload');ok(t.manager.getText(t.id)===local&&t.manager.metadata(t.id).dirty);ok(f.undoDepth(t.manager.getState(t.id))===depth);ok(JSON.stringify(t.transport.records.get(r.id))===before,'last valid snapshot changed on failure');ok(t.recovery.lastError.value.includes('injected recovery write failure'));ok(t.external.blocked(t.id));ok(await t.files.autoSave(t.id)==='skipped');t.transport.fail=false;await t.external.requestReload(t.id);ok(await t.external.confirmReload());ok(t.transport.records.get(r.id).text===local)}finally{t.dispose()}
 })
 await test('26 local edits during checkpoint invalidate reload, preserve the new buffer and keep autosave paused',async()=>{
  const t=make();try{await t.ready;t.edit(' A');await t.recovery.flushForClose();t.change('external');await t.external.check(t.id);await t.external.requestReload(t.id);t.transport.gate=defer();const before=t.transport.calls.length,pending=t.external.confirmReload();while(t.transport.calls.length===before)await new Promise(r=>setTimeout(r,0));t.edit(' C during snapshot');t.transport.gate.resolve();ok(!await pending);ok(t.manager.getText(t.id).endsWith(' C during snapshot'));ok(t.manager.metadata(t.id).dirty&&t.external.blocked(t.id));ok(await t.files.autoSave(t.id)==='skipped');t.transport.gate=null;await t.recovery.flushForClose();ok([...t.transport.records.values()].some(r=>r.text===t.manager.getText(t.id)))}finally{t.dispose()}
 })
 await test('27 a file changed after read delivery invalidates the old operation without losing its local checkpoint',async()=>{
  const t=make();try{await t.ready;t.edit(' local');const local=t.manager.getText(t.id);t.change('disk A');await t.external.check(t.id);await t.external.requestReload(t.id);const read=t.gateway.readExternal;t.gateway.readExternal=async(...args)=>{const snapshot=await read(...args);t.change('disk B after read');return snapshot};ok(!await t.external.confirmReload());ok(t.manager.getText(t.id)===local&&t.manager.metadata(t.id).dirty);ok([...t.transport.records.values()].some(r=>r.text===local));ok(t.external.blocked(t.id));await t.recovery.open();ok(t.recovery.records.value.length>0)}finally{t.dispose()}
 })
 await test('28 missing recovery protection fails closed; same-path Save As and blocked autosave never write the conflict file',async()=>{
  const t=make();try{await t.ready;t.edit(' local');t.change('external');await t.external.check(t.id);t.external.setRecoveryCheckpoint(undefined);await t.external.requestReload(t.id);ok(!await t.external.confirmReload());const path=t.disk.path.replaceAll('/','\\');t.target={token:'extra',path:f.usesCaseInsensitivePaths()?path.toUpperCase():path,version:t.disk.version};ok(!await t.files.save(t.id,true));ok(t.released.includes('extra'));ok(await t.files.autoSave(t.id)==='skipped');ok(t.writes.length===0&&t.manager.metadata(t.id).dirty)}finally{t.dispose()}
 })
 assert.deepEqual(errors,[])
 fs.writeFileSync(`${output}/results.json`,JSON.stringify({results,eventMetrics},null,2))
 console.log(`PASS ${results.length} groups; event metrics ${JSON.stringify(eventMetrics)}`)
} finally {await browser?.close();await server.close()}
