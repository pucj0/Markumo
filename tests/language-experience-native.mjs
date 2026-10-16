import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createServer } from 'node:net'
import { chromium } from 'playwright'

assert.equal(process.platform,'win32','Windows/WebView2 native test')
const root=resolve('.'),output=resolve('test-results/language-experience-native',String(Date.now())),profile=join(output,'profile')
await mkdir(profile,{recursive:true})
const names=['Hello.java','example.js','main.ts','example.cpp','example.sh','example.bat','example.py','Example.vue','Example.cs','example.sql','README.md']
for(const name of [...names,'logo.png'])await copyFile(join(root,'tests/fixtures/language-experience',name),join(output,name))
const file=join(output,'README.md'),original=(await readFile(file,'utf8')).replace(/\r?\n/g,'\r\n'),bom=Buffer.from([239,187,191])
await writeFile(file,Buffer.concat([bom,Buffer.from(original)]))
await writeFile(join(profile,'editor-settings.json'),'{}')
await writeFile(join(profile,'workspaces.json'),JSON.stringify({recent_workspaces:['\\\\?\\'+output],active_roots:['\\\\?\\'+output]}))
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port}
const vitePort=await port(),debugPort=await port(),url=`http://localhost:${vitePort}`
const env={...process.env,LIGHTEDIT_DEV_DATA_DIR:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${debugPort}`,CARGO_NET_OFFLINE:'true'}
const config={identifier:`com.lightedit.language-test-${Date.now()}`,build:{beforeDevCommand:`pnpm dev --host 127.0.0.1 --port ${vitePort} --strictPort`,devUrl:url}}
// A unique identifier prevents routing fixture files into an existing user app.
// Only the child process tree created below is eligible for cleanup.
const child=spawn(process.execPath,[join(root,'scripts/tauri.mjs'),'dev','--config',JSON.stringify(config),'--no-watch','--','--',...names.filter(n=>n!=='README.md').map(n=>join(output,n)),file],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
let logs='',exitCode,browser,page,failure;const results=[],errors=[]
child.stdout.on('data',v=>logs+=v);child.stderr.on('data',v=>logs+=v);child.on('exit',code=>exitCode=code)
const pause=ms=>new Promise(r=>setTimeout(r,ms))
async function test(name,run){await run();results.push({name,result:'PASS'});console.log(`PASS ${name}`)}
const app=()=>page.evaluate(()=>{const a=document.querySelector('#app').__vue_app__._instance.setupState;return {id:a.manager.activeId,text:a.manager.saveSnapshot(a.manager.activeId)?.text}})
try{
  const deadline=Date.now()+240000
  while(Date.now()<deadline){if(exitCode!==undefined)throw Error(`App exited ${exitCode}: ${logs.slice(-3000)}`);try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);break}catch{await pause(250)}}
  assert.ok(browser,'isolated WebView2 startup')
  for(let i=0;i<100;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith(url));if(page)break;await pause(100)}assert.ok(page)
  page.on('pageerror',e=>errors.push(e.message))
  await page.waitForFunction(()=>document.querySelector('#app')?.__vue_app__?._instance.setupState.manager.openedDocuments.some(d=>d.name==='README.md'))
  await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;m.open(m.openedDocuments.find(d=>d.name==='README.md').id,false)})
  await page.locator('.md-prose').waitFor({timeout:30000})
  await test('native Live Java/Bash/JS/SQL have multiple real computed token colors and local code gutters',async()=>{
    await page.waitForFunction(()=>[...document.querySelectorAll('.md-code-block')].every(b=>b.dataset.languageStatus==='ready'))
    for(let i=0;i<4;i++){
      const b=page.locator('.md-code-block').nth(i),colors=await b.evaluate(el=>[...el.querySelectorAll('.cm-line span')].map(s=>getComputedStyle(s).color))
      assert.ok(new Set(colors).size>=3)
      assert.equal(await b.locator('.cm-gutterElement').filter({hasText:/^1$/}).count(),1)
    }
    assert.equal((await app()).text,original)
  })
  await test('native local link source edits save exact UTF-8 BOM/CRLF and keep unrelated Markdown byte-identical',async()=>{
    await page.locator('.md-prose a').filter({hasText:'中文 English 链接'}).click()
    await page.locator('.md-inline-source-input').waitFor()
    await page.locator('.md-inline-source-input').fill('[中文 English 链接](https://example.com/native)')
    await page.keyboard.press('Escape')
    const expected=original.replace('https://example.com/old','https://example.com/native')
    assert.equal((await app()).text,expected)
    await page.evaluate(async()=>{const a=document.querySelector('#app').__vue_app__._instance.setupState;await a.files.save(a.manager.activeId)})
    assert.deepEqual(await readFile(file),Buffer.concat([bom,Buffer.from(expected)]))
    await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.command('undo'))
    assert.equal((await app()).text,original)
  })
  await test('native image source preserves visible authorized image; H3 and table stay structured',async()=>{
    await page.locator('.md-live-image img').first().click()
    await page.locator('.md-inline-source-input').waitFor()
    assert.equal(await page.locator('.md-live-image img').first().isVisible(),true)
    await page.locator('.md-inline-source-input').fill('![原生图片](./logo.png)');await page.keyboard.press('Escape')
    assert.ok((await app()).text.includes('![原生图片]'))
    await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.command('undo'))
    await page.locator('.md-prose h3').first().click();assert.equal(await page.locator('.md-prose h3').first().getAttribute('data-heading-level'),'h3')
    await page.locator('.md-prose td').first().click();assert.equal(await page.locator('.md-prose table').count(),1)
    assert.equal((await app()).text,original)
    await page.screenshot({path:join(output,'native-live.png')})
  })
  await test('native authorized ordinary files have real syntax colors and mode changes preserve Markdown',async()=>{
    for(const name of names.filter(n=>n!=='README.md')){
      await page.evaluate(name=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;m.open(m.openedDocuments.find(d=>d.name===name).id,false)},name)
      await page.waitForFunction(name=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;return m.activeDocument.name===name&&m.activeDocument.languageStatus==='ready'},name)
      const colors=await page.locator('.editor-host>.cm-editor').evaluate(el=>[...el.querySelectorAll('.cm-line span')].map(s=>getComputedStyle(s).color))
      assert.ok(new Set(colors).size>=3,name)
      await page.screenshot({path:join(output,`native-${name}.png`)})
    }
    await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;m.open(m.openedDocuments.find(d=>d.name==='README.md').id,false)})
    const before=(await app()).text
    for(const mode of ['source','split','live']){
      await page.evaluate(mode=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;m.setMarkdownMode(m.activeId,mode)},mode)
      if(mode==='live')await page.locator('.md-prose').waitFor()
      assert.equal((await app()).text,before)
    }
  })
  await test('native inline glyph input and document find/select-all route through Live with exact undo',async()=>{
    const before=(await app()).text,strong=page.locator('.md-prose strong').first()
    await strong.scrollIntoViewIfNeeded()
    const point=await strong.evaluate(el=>{const r=document.createRange();r.setStart(el.firstChild,2);r.setEnd(el.firstChild,3);const b=r.getBoundingClientRect();return {x:b.left+.1,y:b.top+b.height/2}})
    await page.mouse.click(point.x,point.y);await page.locator('.md-inline-source-input').waitFor();await page.keyboard.insertText('原生')
    assert.equal((await app()).text,before.replace('**加粗中文**','**加粗原生中文**'))
    await page.keyboard.press('Escape');await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.command('undo'));assert.equal((await app()).text,before)
    await strong.click();await page.locator('.md-inline-source-input').waitFor();await page.keyboard.press('Control+f')
    assert.equal(await page.locator('.md-live-search').isVisible(),true);await page.keyboard.press('Escape')
    await strong.click();await page.locator('.md-inline-source-input').waitFor();await page.keyboard.press('Control+a')
    assert.equal(await page.evaluate(()=>[...document.querySelector('#app').__vue_app__._instance.setupState.manager.liveViews.values()][0].editor.view.state.selection.toJSON().type),'all')
    assert.equal((await app()).text,before)
    await page.screenshot({path:join(output,'native-inline-shortcuts.png')})
  })
  assert.deepEqual(errors,[])
}catch(error){failure=error;console.error(error);if(page)await page.screenshot({path:join(output,'failure.png')}).catch(()=>{})}
finally{
  await writeFile(join(output,'results.json'),JSON.stringify({results,errors,failure:failure?String(failure):null,identifier:config.identifier,devUrl:url},null,2));await writeFile(join(output,'tauri.log'),logs)
  if(page)await page.evaluate(async()=>{const {getCurrentWindow}=await import('/node_modules/@tauri-apps/api/window.js');await getCurrentWindow().destroy()}).catch(()=>{})
  if(browser)await browser.close().catch(()=>{})
  if(exitCode===undefined)try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'})}catch{}
}
if(failure)process.exitCode=1
