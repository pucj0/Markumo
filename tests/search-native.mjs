import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createServer } from 'node:net'
import { chromium } from 'playwright'
import { searchFiles, searchSample, runSearchChecks, openSearchFile, assertSearchGeometry } from './helpers/search-checks.mjs'

assert.equal(process.platform,'win32')
const root=resolve('.'),output=resolve('test-results/search-native',String(Date.now())),profile=join(output,'profile')
await mkdir(profile,{recursive:true})
const original=searchSample.replaceAll('\n','\r\n'),bom=Buffer.from([239,187,191])
for(const name of searchFiles)await writeFile(join(output,name),Buffer.concat([bom,Buffer.from(original)]))
await writeFile(join(profile,'editor-settings.json'),JSON.stringify({settingsVersion:4,fontSize:17,theme:'dark',autoSave:false,markdownTypography:{fontSize:19}}))
async function port(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const value=server.address().port;await new Promise(r=>server.close(r));return value}
const vitePort=await port(),debugPort=await port(),url=`http://localhost:${vitePort}`
const config={identifier:`com.lightedit.search-test-${Date.now()}`,build:{beforeDevCommand:`pnpm dev --host 127.0.0.1 --port ${vitePort} --strictPort`,devUrl:url}}
const env={...process.env,LIGHTEDIT_DEV_DATA_DIR:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${debugPort}`,CARGO_NET_OFFLINE:'true'}
const results=[],errors=[],evidence={};let logs='',child,browser,page,exitCode,failure
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function test(name,run){await run();results.push({name,result:'PASS'});console.log(`PASS ${name}`)}
async function launch(){
  exitCode=undefined
  child=spawn(process.execPath,[join(root,'scripts/tauri.mjs'),'dev','--config',JSON.stringify(config),'--no-watch','--','--',...searchFiles.map(name=>join(output,name))],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
  child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);child.on('exit',code=>exitCode=code)
  const deadline=Date.now()+240000
  while(Date.now()<deadline){if(exitCode!==undefined)throw Error(`Native app exited ${exitCode}: ${logs.slice(-3500)}`);try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);break}catch{await pause(300)}}
  assert.ok(browser,'isolated WebView2 startup')
  for(let i=0;i<100;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith(url));if(page)break;await pause(100)}
  assert.ok(page);page.on('pageerror',error=>errors.push(error.message))
  await page.waitForFunction(()=>document.querySelector('#app')?.__vue_app__?._instance.setupState.manager.openedDocuments.length>=6)
}
async function stop(){
  if(page)await page.evaluate(async()=>{const {getCurrentWindow}=await import('/node_modules/@tauri-apps/api/window.js');await getCurrentWindow().destroy()}).catch(()=>{})
  if(browser)await browser.close().catch(()=>{})
  if(exitCode===undefined&&child)try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'})}catch{}
  page=undefined;browser=undefined
}
try {
  await launch()
  await test('native v4 preferences fill UI 14 without changing source 17 / prose 19',async()=>{
    assert.deepEqual(await page.evaluate(()=>{const a=document.querySelector('#app').__vue_app__._instance.setupState;return [a.uiFontSize,a.fontSize,a.markdownTypography.fontSize,a.autoSave]}),[14,17,19,false])
    evidence.devicePixelRatio=await page.evaluate(()=>devicePixelRatio)
  })
  await runSearchChecks(page,{test,output})
  await test('native workspace/UI 16, real computed controls, exact BOM/CRLF save and shared Undo',async()=>{
    await page.evaluate(async output=>{const a=document.querySelector('#app').__vue_app__._instance.setupState;await a.workspace.openWorkspacePath(output);a.sidebarVisible=true},output)
    await page.getByTitle('设置',{exact:true}).click();await page.getByLabel('界面字号',{exact:true}).fill('16');await page.getByLabel('界面字号',{exact:true}).blur()
    await page.screenshot({path:join(output,'native-settings-16.png')});await page.getByRole('button',{name:'完成',exact:true}).click()
    await openSearchFile(page,'live.md','live')
    await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.command('replace'))
    const bar=page.locator('.fleet-search:visible').first()
    await bar.locator('input[name=search]').fill('(import)(\\d+)');await bar.locator('input[name=re]').check();await bar.locator('input[name=replace]').fill('$1-$2')
    await page.waitForTimeout(100);evidence.geometry=await assertSearchGeometry(bar)
    assert.equal(evidence.geometry.find.font,'16px')
    assert.equal(await page.locator('.md-document').evaluate(el=>getComputedStyle(el).fontSize),'19px')
    await page.screenshot({path:join(output,'native-live-search-16.png')})
    await bar.locator('button[name=replaceAll]').click()
    await page.evaluate(async()=>{const a=document.querySelector('#app').__vue_app__._instance.setupState;await a.files.save(a.manager.activeId)})
    const expected=original.replace(/(import)(\d+)/gu,'$1-$2')
    assert.deepEqual(await readFile(join(output,'live.md')),Buffer.concat([bom,Buffer.from(expected)]))
    await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.command('undo'))
    await page.evaluate(async()=>{const a=document.querySelector('#app').__vue_app__._instance.setupState;await a.files.save(a.manager.activeId)})
    assert.deepEqual(await readFile(join(output,'live.md')),Buffer.concat([bom,Buffer.from(original)]))
    await page.waitForFunction(()=>document.querySelector('#app').__vue_app__._instance.setupState.uiFontSize===16)
    for(let i=0;i<30;i++){if(JSON.parse(await readFile(join(profile,'editor-settings.json'),'utf8')).uiFontSize===16)break;await pause(100)}
    const settings=JSON.parse(await readFile(join(profile,'editor-settings.json'),'utf8'));assert.equal(settings.uiFontSize,16);assert.equal(settings.settingsVersion,5)
  })
  await stop();await pause(600);await launch()
  await test('native process restart restores UI 16 and independent source/prose preferences',async()=>{
    assert.deepEqual(await page.evaluate(()=>{const a=document.querySelector('#app').__vue_app__._instance.setupState;return [a.uiFontSize,a.fontSize,a.markdownTypography.fontSize,a.autoSave]}),[16,17,19,false])
    await openSearchFile(page,'search.txt')
    assert.equal(await page.locator('.editor-host > .cm-editor .cm-content').evaluate(el=>getComputedStyle(el).fontSize),'17px')
    await page.screenshot({path:join(output,'native-restarted-16.png')})
  })
  assert.deepEqual(errors,[])
}catch(error){failure=String(error);console.error(error);if(page)await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});process.exitCode=1}
finally{await stop();await writeFile(join(output,'results.json'),JSON.stringify({results,errors,evidence,failure,identifier:config.identifier},null,2));await writeFile(join(output,'tauri.log'),logs);console.log(output)}
