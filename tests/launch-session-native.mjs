import assert from 'node:assert/strict'
import {spawn,execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=dirname(dirname(fileURLToPath(import.meta.url))),output=join(root,'test-results/launch-session-native',String(Date.now()))
const profile=join(output,'profile'),workspace=join(output,'工作区 space'),sessionPath=join(profile,'last-session.json')
const paths=['a 中文.txt','b.md','c.js','d.bat'].map(name=>join(workspace,name))
const {chromium}=createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE||import.meta.url)('playwright')
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),canonical=path=>'\\\\?\\'+path
assert.equal(execFileSync('powershell.exe',['-NoProfile','-Command','Get-Process lightedit -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id; exit 0'],{encoding:'utf8'}).trim(),'','Save and close existing LightEdit; this test only controls isolated windows.')
await Promise.all([mkdir(profile,{recursive:true}),mkdir(workspace,{recursive:true})])
await Promise.all(paths.map((path,i)=>writeFile(path,['plain中文\r\n','# Markdown\n正文','const value=1;','@echo off\r\necho NEVER_EXECUTED\r\n'][i])))
await writeFile(join(profile,'editor-settings.json'),JSON.stringify({autoSave:false}))
await writeFile(join(profile,'workspaces.json'),JSON.stringify({recent_workspaces:[canonical(workspace)],active_roots:[canonical(workspace)]}))
await writeFile(join(profile,'files.json'),JSON.stringify({recent:paths.map(path=>({path:canonical(path),name:path.split('\\').at(-1)})),layout:{mode:'workspace',sidebarVisible:true,sidebarWidth:300}}))
const env={...process.env,LIGHTEDIT_DEV_DATA_DIR:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9232',CARGO_NET_OFFLINE:'true'}
const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path')||'PATH';env[pathKey]=join(process.env.USERPROFILE,'.cargo/bin')+';'+env[pathKey]
let child,exitCode,browser,page,failure,logs='';const results=[],errors=[]
async function test(name,run){await run();results.push({name,result:'PASS'});console.log(`PASS ${name}`)}
async function connect(args=[]){
  exitCode=undefined
  child=spawn(process.execPath,[join(root,'scripts/tauri.mjs'),'dev','--no-watch','--','--',...args],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
  child.stdout.on('data',value=>{logs+=value});child.stderr.on('data',value=>{logs+=value});child.on('exit',code=>{exitCode=code})
  const deadline=Date.now()+120000;browser=undefined
  while(Date.now()<deadline){if(exitCode!==undefined)throw Error(`CLI exited ${exitCode}: ${logs.slice(-1800)}`);try{browser=await chromium.connectOverCDP('http://127.0.0.1:9232');break}catch{await pause(200)}}
  assert.ok(browser)
  for(let i=0;i<100;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://localhost:1420'));if(page)break;await pause(100)}
  assert.ok(page);page.on('pageerror',e=>errors.push(e.message))
  await ready(page)
}
async function ready(target){await target.waitForFunction(()=>{const s=document.querySelector('#app')?.__vue_app__?._instance?.setupState;return s&&!s.startupLoading&&!s.fileBusy},{},{timeout:15000})}
async function state(target=page){return target.evaluate(()=>{const s=document.querySelector('#app').__vue_app__._instance.setupState;return {names:s.manager.openedDocuments.map(d=>d.name),paths:s.manager.openedDocuments.map(d=>d.path),active:s.manager.activeDocument?.name,roots:s.workspace.roots.map(r=>r.rootPath),mode:s.appMode,sidebar:s.sidebarVisible,label:window.__TAURI_INTERNALS__.metadata.currentWindow.label,dirty:s.manager.hasDirtyDocuments}})}
async function close(target=page){const done=target.waitForEvent('close',{timeout:10000});await target.getByRole('button',{name:'关闭窗口',exact:true}).click();await done}
async function stop(){await close();for(let i=0;i<80&&exitCode===undefined;i++)await pause(100);assert.notEqual(exitCode,undefined);await pause(300)}
async function lastSession(predicate){for(let i=0;i<100;i++){try{const s=JSON.parse(await readFile(sessionPath,'utf8'));if(predicate(s))return s}catch{}await pause(100)}throw Error('Expected Last Session was not persisted')}
async function secondInstance(args){
  const previous=new Set(browser.contexts().flatMap(c=>c.pages()))
  const external=spawn(join(root,'src-tauri/target/debug/lightedit.exe'),args,{cwd:root,env,windowsHide:true,stdio:'ignore'})
  await new Promise((resolve,reject)=>{external.once('error',reject);external.once('exit',code=>code===0?resolve():reject(Error(`second instance exit ${code}`)))})
  for(let i=0;i<150;i++){
    const target=browser.contexts().flatMap(c=>c.pages()).find(p=>!previous.has(p)&&p.url().startsWith('http://localhost:1420'))
    if(target){target.on('pageerror',e=>errors.push(e.message));await ready(target);return target}
    await pause(100)
  }
  throw Error('External launch did not create an isolated window')
}
try{
  await connect()
  await test('App Launch without Last Session ignores recents/old active roots and shows a safe welcome',async()=>{
    assert.deepEqual((await state()).names,[]);assert.deepEqual((await state()).roots,[])
    assert.equal(await page.locator('.cm-editor').count(),0);assert.equal(await page.getByRole('region',{name:'LightEdit 欢迎页'}).count(),1)
  })
  await test('Main app records real workspace tabs, order and active file independently of Recents',async()=>{
    await page.evaluate(async root=>{await document.querySelector('#app').__vue_app__._instance.setupState.workspace.openWorkspacePath(root)},canonical(workspace))
    for(const name of ['a 中文.txt','b.md'])await page.evaluate(async name=>{const s=document.querySelector('#app').__vue_app__._instance.setupState;await s.workspace.openFile(s.workspace.entries.find(n=>n.name===name),false)},name)
    await page.getByRole('tab',{name:'a 中文.txt',exact:true}).click()
    const saved=await lastSession(s=>s.tabs.length===2&&s.activePath?.endsWith('a 中文.txt'))
    assert.equal(saved.kind,'workspace');assert.deepEqual(saved.tabs.map(t=>t.path.split('\\').at(-1)),['a 中文.txt','b.md'])
    assert.equal((await state()).mode,'workspace')
  })
  await test('Running app routes TXT/MD/JS/BAT launch to an independent file window, preserving dirty main editor',async()=>{
    await page.getByRole('textbox',{name:'文本编辑器',exact:true}).fill('main dirty中文')
    const before=await readFile(sessionPath,'utf8'),mainBefore=await state()
    const external=await secondInstance(paths)
    const actual=await state(external)
    assert.deepEqual(actual.names,paths.map(p=>p.split('\\').at(-1)));assert.equal(actual.mode,'single');assert.equal(actual.sidebar,false);assert.deepEqual(actual.roots,[])
    assert.equal(await external.locator('[role=tab]').filter({hasText:'Untitled'}).count(),0)
    const denied=await external.evaluate(async()=>{try{await window.__TAURI_INTERNALS__.invoke('persist_session',{input:{kind:'single',tabs:[],activeToken:null,layout:{mode:'single',sidebarVisible:false,sidebarWidth:254}}});return false}catch{return true}})
    assert.equal(denied,true);assert.equal(await readFile(sessionPath,'utf8'),before)
    assert.deepEqual(await state(),mainBefore)
    const mainToken=await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.activeDocument.fileToken)
    assert.equal(await external.evaluate(async token=>{try{await window.__TAURI_INTERNALS__.invoke('reopen_file',{token,encoding:'UTF-8'});return false}catch{return true}},mainToken),true)
    await close(external);assert.deepEqual(await state(),mainBefore)
    await page.getByRole('button',{name:'关闭窗口',exact:true}).click();await page.getByRole('dialog',{name:'未保存修改确认',exact:true}).waitFor();await page.getByRole('button',{name:'继续编辑',exact:true}).click()
    assert.equal(await page.getByRole('textbox',{name:'文本编辑器',exact:true}).innerText(),'main dirty中文')
    await page.getByRole('textbox',{name:'文本编辑器',exact:true}).press('Control+z')
  })
  await test('Missing File Launch gives error/empty state and cannot replace the main session',async()=>{
    const before=await readFile(sessionPath,'utf8'),external=await secondInstance([join(output,'missing.txt')])
    assert.deepEqual((await state(external)).names,[]);assert.deepEqual((await state(external)).roots,[])
    assert.equal(await external.locator('.cm-editor').count(),0);assert.match(await external.locator('.toast').innerText(),/missing.txt/)
    await close(external);assert.equal(await readFile(sessionPath,'utf8'),before)
  })
  await stop();await connect()
  await test('Closing/restarting App Launch restores workspace, exact tab order and active tab',async()=>{
    const s=await state();assert.deepEqual(s.names,['a 中文.txt','b.md']);assert.equal(s.active,'a 中文.txt');assert.equal(s.roots.length,1);assert.equal(s.mode,'workspace');assert.equal(s.dirty,false)
    await page.getByRole('tab',{name:'b.md',exact:true}).click();await lastSession(s=>s.activePath?.endsWith('b.md'))
  })
  await stop();const beforeFile=await readFile(sessionPath,'utf8');await connect([paths[2],paths[3]])
  await test('Standalone File Launch opens only supplied files, no workspace/draft/session replacement',async()=>{
    const s=await state();assert.deepEqual(s.names,['c.js','d.bat']);assert.deepEqual(s.roots,[]);assert.equal(s.sidebar,false);assert.equal(s.mode,'single')
    await page.getByRole('tab',{name:'d.bat',exact:true}).click();await pause(350)
    assert.equal(await readFile(sessionPath,'utf8'),beforeFile)
  })
  await stop();assert.equal(await readFile(sessionPath,'utf8'),beforeFile)
  await unlink(paths[1]);await connect()
  await test('Missing restored file is skipped, remaining real file and workspace survive',async()=>{
    assert.deepEqual((await state()).names,['a 中文.txt']);assert.equal((await state()).active,'a 中文.txt');assert.equal((await state()).roots.length,1)
    assert.match(await page.locator('.toast').innerText(),/无法恢复/)
  })
  await stop();await writeFile(sessionPath,'broken session');await connect()
  await test('Corrupt session safely falls back to welcome without arbitrary-path API or Untitled',async()=>{
    assert.deepEqual((await state()).names,[]);assert.deepEqual((await state()).roots,[]);assert.equal(await page.locator('.cm-editor').count(),0)
    assert.match(await page.locator('.toast').innerText(),/会话损坏/)
  })
  await test('App Launch without a workspace records independent files as single-file session',async()=>{
    await page.evaluate(async path=>{await document.querySelector('#app').__vue_app__._instance.setupState.openRecent(path)},canonical(paths[2]))
    await lastSession(s=>s.kind==='single'&&s.tabs.length===1&&s.tabs[0].path.endsWith('c.js'))
  })
  await stop();await connect()
  await test('Single-file App Session restores its actual tab, without restoring workspace or recent files',async()=>{
    assert.deepEqual((await state()).names,['c.js']);assert.deepEqual((await state()).roots,[]);assert.equal((await state()).mode,'single');assert.equal((await state()).sidebar,false)
  })
  await stop();assert.deepEqual(errors,[])
}catch(error){failure=String(error);console.error(failure);try{await page?.screenshot({path:join(output,'failure.png')});await writeFile(join(output,'failure-state.json'),JSON.stringify(await state(),null,2))}catch{}}
finally{
  if(browser?.isConnected())for(const target of browser.contexts().flatMap(c=>c.pages()))try{await target.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|destroy',{label:window.__TAURI_INTERNALS__.metadata.currentWindow.label}))}catch{}
  for(let i=0;i<30&&exitCode===undefined;i++)await pause(100)
  if(exitCode===undefined)child?.kill()
  await writeFile(join(output,'native.log'),logs);await writeFile(join(output,'results.json'),JSON.stringify({results,errors,failure,realRustIPC:true,explorerDoubleClick:'NOT RUN; equivalent executable+path and real single-instance callback tested',systemIME:'NOT RUN'},null,2))
}
if(failure)process.exitCode=1
