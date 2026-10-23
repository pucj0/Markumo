// Real Release / WebView2 / Rust IPC and disk. No native history mock.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {chromium} from 'playwright'
assert.equal(process.platform,'win32')
const root=path.resolve('test-results/repair05-native')
const manifest=JSON.parse(fs.readFileSync(path.join(root,'build.json'),'utf8'))
const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'))
assert.equal(config.identifier,'com.markumo.repair05-audit')
const profile=fs.realpathSync(manifest.profile)
assert.equal(path.dirname(profile),fs.realpathSync(root))
assert.equal(profile,fs.realpathSync(config.app.appDirectoriesOverride))
const sha=b=>createHash('sha256').update(b).digest('hex')
assert.equal(path.resolve(manifest.binary),path.join(root,'markumo-acceptance.exe'))
assert.equal(sha(fs.readFileSync(manifest.binary)),manifest.sha256)
assert(fs.readFileSync(manifest.binary).includes(Buffer.from(config.identifier)),'Refusing a production-profile binary')
const run=fs.mkdtempSync(path.join(root,'run-')),file=path.join(run,'history.md')
const temporary=path.join(run,'tmp');fs.mkdirSync(temporary)
const canonical=path.toNamespacedPath(file),original='# Original\r\n旧正文😀\r\n'
const editorOriginal=original.replaceAll('\r\n','\n')
fs.writeFileSync(file,original)
fs.writeFileSync(path.join(profile,'editor-settings.json'),JSON.stringify({settingsVersion:6,autoCheckUpdates:false,autoDownloadUpdates:false,autoSave:false,externalFileMonitoring:false}))
fs.writeFileSync(path.join(profile,'files.json'),JSON.stringify({recent:[{path:canonical,name:'history.md'}],layout:{mode:'single',sidebarVisible:false,sidebarWidth:240}}))
const seedSession=()=>fs.writeFileSync(path.join(profile,'last-session.json'),JSON.stringify({schemaVersion:1,kind:'single',roots:[],tabs:[],activePath:null,layout:{mode:'single',sidebarVisible:false,sidebarWidth:240}}))
seedSession()
const report={commit:manifest.commit,binarySha256:manifest.sha256,profile,tests:[],errors:[],limitations:['Native Word save picker is not automated; Worker CSP/cancellation and raw IPC rejection are exercised, successful binary commits have Rust tests.']} 
let child,browser,page
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function launch(index){
 const port=9780+index
 child=spawn(manifest.binary,[],{windowsHide:true,stdio:'pipe',env:{...process.env,TEMP:temporary,TMP:temporary,WEBVIEW2_USER_DATA_FOLDER:path.join(run,'webview-'+index),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`}})
 let diagnostic='';child.stderr.on('data',b=>diagnostic=(diagnostic+b).slice(-8192));child.on('error',e=>report.errors.push(String(e)))
 const deadline=Date.now()+45000
 while(true){if(child.exitCode!==null)throw Error('Native app exited: '+diagnostic);try{if((await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)})).ok)break}catch{}assert(Date.now()<deadline,'WebView2 endpoint timed out');await wait(50)}
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
 report.webviewRuntime=browser.version()
 page=browser.contexts().flatMap(c=>c.pages()).find(p=>!p.url().startsWith('devtools:'))
 page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.accept())
 await page.waitForFunction(()=>globalThis.__repairShell?.settingsReady.value&&!globalThis.__repairShell.startupLoading.value,null,{timeout:30000})
 await page.evaluate(async file=>{const s=globalThis.__repairShell;if(s.recoveryVisible.value)s.closeRecovery();await s.files.recent(file);globalThis.__historyDoc=s.manager.activeId},canonical)
 assert.equal(await page.evaluate(()=>__repairShell.manager.activeDocument.name),'history.md')
}
async function stop(){if(child){const exited=new Promise(r=>child.once('exit',r));child.kill();await Promise.race([exited,wait(5000)]);child=null}await browser?.close().catch(()=>{});browser=null}
const text=()=>page.evaluate(()=>__repairShell.manager.getText(__historyDoc))
const edit=value=>page.evaluate(value=>{const m=__repairShell.manager,id=__historyDoc;m.dispatch(id,{changes:{from:0,to:m.getText(id).length,insert:value},userEvent:'input.acceptance'})},value)
const list=()=>page.evaluate(()=>__repairNative.invoke('history_list',{path:__repairShell.manager.metadata(__historyDoc).path}))
const read=id=>page.evaluate(id=>__repairNative.invoke('history_read',{path:__repairShell.manager.metadata(__historyDoc).path,id}),id)
const pass=name=>{report.tests.push(name);console.log('PASS '+name)}
try{
 await launch(0)
 const next='# Saved\r\n新正文😀\r\n'
 await edit(next)
 const saves=await page.evaluate(()=>Promise.all([__repairShell.files.saveDetailed(__historyDoc),__repairShell.files.saveDetailed(__historyDoc)]))
 report.saves=saves
 assert.deepEqual(saves.map(s=>s.code),['saved','busy'],JSON.stringify(saves));assert.equal(fs.readFileSync(file,'utf8'),next)
 const entries=await list();assert.equal(entries.length,2)
 for(const body of [original,next]){const row=entries.find(r=>r.hash===sha(body));assert(row);assert.equal(await read(row.id),body)}
 pass('actual FileController → Rust archive → atomic disk save → persisted new history; concurrent save guarded; CRLF and Unicode exact')
 // Both native path spellings address the same stored history.
 assert.deepEqual(await page.evaluate(file=>__repairNative.invoke('history_list',{path:file}),file),entries)
 pass('display and Windows namespace paths share the native history index')
 await page.evaluate(()=>__repairShell.manager.splitPane('right'))
 await page.waitForFunction(()=>document.querySelectorAll('[data-pane-id]').length>=2)
 await edit('# Unsaved\ncurrent edits')
 await page.evaluate(()=>{const s=__repairShell;s.historyPath.value=s.manager.metadata(__historyDoc).path;s.historyDocumentId.value=__historyDoc;s.historyContent.value=s.manager.getText(__historyDoc);s.historyOpen.value=true})
 await page.locator('.history-item').nth(entries.findIndex(e=>e.hash===sha(original))).click()
 await page.waitForFunction(body=>document.querySelector('.history-preview-pre')?.textContent===body,original)
 await page.locator('.history-action-btn.restore').click()
 await page.getByRole('button',{name:'确认恢复',exact:true}).click()
 await page.waitForFunction(body=>__repairShell.manager.getText(__historyDoc)===body,editorOriginal)
 assert.equal(fs.readFileSync(file,'utf8'),next,'restore must not overwrite disk implicitly')
 await page.screenshot({path:path.join(root,'history-restored.png')})
 await page.evaluate(()=>__repairShell.manager.command('undo'))
 assert.equal(await text(),'# Unsaved\ncurrent edits')
 await page.evaluate(()=>__repairShell.manager.command('redo'))
 assert.equal(await text(),editorOriginal)
 pass('real HistoryDialog reads native body, protects edits, restores canonical multi-pane document with one Undo/Redo')
 if(await page.locator('.history-close-btn').count())await page.locator('.history-close-btn').click()
 // Fault the isolated store directory without deleting any history objects.
 const history=path.join(profile,'history'),held=path.join(profile,'history-held')
 assert.equal(path.dirname(fs.realpathSync(history)),profile)
 fs.renameSync(history,held);fs.writeFileSync(history,'injected unavailable history directory')
 try{
  await edit('# Must remain in editor\narchive fault')
  const result=await page.evaluate(()=>__repairShell.files.saveDetailed(__historyDoc))
  assert.notEqual(result.code,'saved');assert.match(result.message,/历史|备份|归档/)
  assert.equal(fs.readFileSync(file,'utf8'),next);assert.equal(await text(),'# Must remain in editor\narchive fault')
  assert.equal(await page.evaluate(()=>__repairShell.manager.metadata(__historyDoc).dirty),true)
  report.archiveFailure=result
 }finally{fs.unlinkSync(history);fs.renameSync(held,history)}
 pass('real native archive I/O failure blocks disk overwrite and retains dirty editor text')
 const worker=await page.evaluate(async()=>{
  let live=0,beats=0;const Base=Worker;globalThis.Worker=class extends Base{constructor(...a){super(...a);live++}terminate(){live--;super.terminate()}}
  try{
   const timer=setInterval(()=>beats++,10),result=await __repairNative.generateDocx('# Native Worker\n\nBody');clearInterval(timer)
   const controller=new AbortController(),started=performance.now(),pending=__repairNative.generateDocx('# Heavy\n\n'+'- item\n\n'.repeat(35000),{signal:controller.signal});setTimeout(()=>controller.abort(),30)
   let cancelled=false;try{await pending}catch(e){cancelled=e.name==='AbortError'}
   let rawError='';try{await __repairNative.invoke('save_docx_bytes',result.bytes,{headers:{'x-markumo-conversion-token':'invalid-acceptance-token'}})}catch(e){rawError=String(e)}
   return{signature:[...result.bytes.slice(0,4)],bytes:result.bytes.length,live,cancelled,cancelMs:performance.now()-started,beats,rawError}
  }finally{globalThis.Worker=Base}
 })
 assert.deepEqual(worker.signature,[80,75,3,4]);assert.equal(worker.cancelled,true);assert.equal(worker.live,0);assert.match(worker.rawError,/授权|失效|凭据|令牌|许可|lease|token/i)
 report.worker=worker
 pass('production CSP allows packaged DOCX Worker; actual CPU cancellation terminates worker; raw native IPC rejects invalid lease')
 // Let the real recovery debounce persist the dirty buffer before terminating
 // this process. No test-only flush or alternate recovery implementation.
 const recoveryRoot=path.join(profile,'recovery'),deadline=Date.now()+8000
 let recovery
 while(!recovery){
  recovery=fs.readdirSync(recoveryRoot).filter(p=>p.endsWith('.json')).map(p=>JSON.parse(fs.readFileSync(path.join(recoveryRoot,p),'utf8'))).find(r=>r.text==='# Must remain in editor\narchive fault')
  if(!recovery){assert(Date.now()<deadline,'dirty crash recovery snapshot was not persisted');await wait(100)}
 }
 report.recoveryId=recovery.id
 const persisted=await list();report.historyBeforeRestart=persisted
 await stop();seedSession();await launch(1)
 assert.equal(await text(),next.replaceAll('\r\n','\n'))
 assert.deepEqual(await list(),persisted)
 for(const entry of persisted)assert.equal(sha(await read(entry.id)),entry.hash)
 pass('after process restart native history IDs and content hashes persist without duplicate snapshots')
 assert.equal(await page.evaluate(id=>__repairShell.recoveryRecords.value.some(r=>r.id===id),recovery.id),true)
 pass('dirty Crash Recovery snapshot survives forced process termination separately from saved history')
 assert.deepEqual(report.errors,[]);report.passed=true
}catch(e){report.failure=String(e.stack||e);await page?.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});throw e}
finally{await stop();fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(report,null,2))}
