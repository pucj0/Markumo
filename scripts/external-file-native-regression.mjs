// Real Windows / WebView2 / Rust notify and IPC. The dedicated audit identifier,
// profile and temporary fixtures are mandatory; never launch the production app.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'vite'
import { chromium } from 'playwright'
assert.equal(process.platform,'win32')
const root=path.resolve('test-results/external-native')
const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8').replace(/^\uFEFF/,''))
assert.equal(config.identifier,'com.markumo.external-audit')
assert.equal(path.resolve(config.app.appDirectoriesOverride),path.join(root,'profile'))
const binary=path.resolve('.markumo-dev/target/debug/markumo.exe')
assert(fs.readFileSync(binary).includes(Buffer.from(config.identifier)),'refusing non-isolated binary')
const profile=config.app.appDirectoriesOverride
assert.equal(path.dirname(fs.realpathSync(profile)),fs.realpathSync(root),'profile must remain inside the dedicated test directory')
assert(!fs.lstatSync(profile).isSymbolicLink(),'refusing linked profile')
fs.rmSync(profile,{recursive:true,force:true})
fs.mkdirSync(profile,{recursive:true})
const run=fs.mkdtempSync(path.join(root,'run-')),file=path.join(run,'native.txt')
fs.writeFileSync(file,'native original\n')
fs.writeFileSync(path.join(profile,'editor-settings.json'),JSON.stringify({settingsVersion:6,autoCheckUpdates:false,autoDownloadUpdates:false,autoSave:false,externalFileMonitoring:true,autoReloadExternal:true}))
const canonical=path.toNamespacedPath(fs.realpathSync.native(file))
fs.writeFileSync(path.join(profile,'last-session.json'),JSON.stringify({schemaVersion:1,kind:'single',roots:[],tabs:[{path:canonical,encoding:'UTF-8'}],activePath:canonical,layout:{mode:'single',sidebarVisible:false,sidebarWidth:240}}))
const server=await createServer({server:{host:'localhost',port:1493,strictPort:true,hmr:false,watch:null}})
await server.listen()
const report={mode:'Windows debug build / isolated identifier and profile / actual Rust watcher and WebView2',errors:[],latenciesMs:[]}
let child,browser
try {
 child=spawn(binary,[],{windowsHide:true,stdio:'pipe',env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:path.join(run,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9739'}})
 let diagnostic='';child.stderr.on('data',b=>diagnostic=(diagnostic+b).slice(-4096));child.on('error',e=>report.errors.push(String(e)))
 const deadline=Date.now()+30000
 while(true){if(child.exitCode!==null)throw Error('native app exited: '+diagnostic);try{if((await fetch('http://127.0.0.1:9739/json/version',{signal:AbortSignal.timeout(500)})).ok)break}catch{}if(Date.now()>deadline)throw Error('native endpoint timeout');await new Promise(r=>setTimeout(r,30))}
 browser=await chromium.connectOverCDP('http://127.0.0.1:9739')
 const page=browser.contexts()[0].pages().find(p=>!p.url().startsWith('devtools:'))
 page.on('pageerror',e=>report.errors.push(e.message))
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent.includes('native original'),null,{timeout:30000})
 await page.waitForFunction(()=>document.querySelector('#app').__vue_app__?._instance?.setupState.files?.external.watchStatus.value?.fileCount===1)
 report.watchBefore=await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.files.external.watchStatus.value)
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('HeapProfiler.collectGarbage')
 const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]))
 report.before=await metrics()
 for(const text of ['external A','external B','external C']){
   const start=performance.now();fs.writeFileSync(file,text+'\n');await page.waitForFunction(text=>document.querySelector('.cm-content')?.textContent.includes(text),text);report.latenciesMs.push(performance.now()-start)
 }
 assert.equal(await page.locator('.external-banner').count(),0,'clean reload should resolve without persistent conflict')
 await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.type('LOCAL BUFFER')
 fs.writeFileSync(file,'disk conflict\n')
 await page.getByRole('button',{name:'比较差异',exact:true}).waitFor()
 assert((await page.locator('.cm-content').first().textContent()).includes('LOCAL BUFFER'))
 await page.getByRole('button',{name:'比较差异',exact:true}).click()
 await page.getByRole('region',{name:'文件差异比较'}).waitFor()
 await page.waitForFunction(()=>document.querySelectorAll('.external-diff .cm-editor').length===2)
 report.diffNavigation=await page.locator('.external-diff nav').textContent()
 assert((await page.locator('.external-diff .cm-content').first().textContent()).includes('disk conflict'))
 assert((await page.locator('.external-diff .cm-content').last().textContent()).includes('LOCAL BUFFER'))
 const start=performance.now();fs.writeFileSync(file,'disk version B\n');await page.locator('.external-diff .stale').waitFor();report.diffStaleLatencyMs=performance.now()-start
 await page.screenshot({path:path.join(root,'native-conflict-diff.png')})
 await page.getByRole('button',{name:'关闭比较并返回编辑器'}).click()
 await page.getByRole('button',{name:'保留当前',exact:true}).click()
 await page.keyboard.press('Control+s')
 assert.equal(fs.readFileSync(file,'utf8'),'disk version B\n')
 assert((await page.locator('.cm-content').first().textContent()).includes('LOCAL BUFFER'))
 const marker=page.getByRole('button',{name:'文件存在外部变化，查看处理选项'})
 await marker.click()
 await page.getByRole('button',{name:'加载磁盘',exact:true}).click();await page.getByRole('dialog').waitFor()
 assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'取消')
 await page.getByRole('button',{name:'确认加载',exact:true}).click()
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent.includes('disk version B')&&!document.querySelector('.cm-content')?.textContent.includes('LOCAL BUFFER'))
 const recovery=fs.readdirSync(path.join(profile,'recovery')).filter(x=>x.endsWith('.json')).map(x=>JSON.parse(fs.readFileSync(path.join(profile,'recovery',x),'utf8')))
 assert(recovery.some(r=>r.text.includes('LOCAL BUFFER')),'pre-reload buffer must have durable recovery snapshot')
 // A delete and immediate replacement is one stable change, not a permanent deletion.
 const temp=path.join(run,'replacement.tmp');fs.writeFileSync(temp,'atomic replacement\n');fs.unlinkSync(file);fs.renameSync(temp,file)
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent.includes('atomic replacement'))
 fs.renameSync(file,path.join(run,'renamed.txt'))
 await page.getByText('原文件已被删除或移动',{exact:true}).waitFor()
 assert((await page.locator('.cm-content').first().textContent()).includes('atomic replacement'))
 await page.screenshot({path:path.join(root,'native-deleted.png')})
 await page.keyboard.press('Control+w')
 await page.waitForFunction(()=>document.querySelector('#app').__vue_app__._instance.setupState.files.external.watchStatus.value?.fileCount===0)
 report.watchAfterClose=await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.files.external.watchStatus.value)
 await cdp.send('HeapProfiler.collectGarbage');report.after=await metrics()
 report.passed=true
 assert.deepEqual(report.errors,[])
} catch(e){report.failure=String(e.stack||e);throw e}
finally{if(child)child.kill('SIGKILL');await browser?.close().catch(()=>{});await server.close();fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(report,null,2))}
console.log('PASS real Windows external change, diff, keep/save protection, recovery reload, atomic replacement and rename',JSON.stringify(report.latenciesMs))
