import assert from 'node:assert/strict'
import {spawn,execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=dirname(dirname(fileURLToPath(import.meta.url))),output=join(root,'test-results/markdown-wysiwyg-native',String(Date.now())),profile=join(output,'profile'),file=join(output,'writing.md')
const {chromium}=createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE||'C:/Users/18089/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')('playwright')
assert.equal(execFileSync('powershell.exe',['-NoProfile','-Command','Get-Process lightedit -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id; exit 0'],{encoding:'utf8'}).trim(),'','Preserve user data: an existing LightEdit window must be saved and closed before this isolated test.')
await mkdir(profile,{recursive:true});const fixture=await readFile(join(root,'tests/fixtures/markdown-wysiwyg.md'),'utf8'),original=fixture.replace(/\r?\n/g,'\r\n'),bom=Buffer.from([239,187,191]);await writeFile(file,Buffer.concat([bom,Buffer.from(original)]));await writeFile(join(profile,'editor-settings.json'),'{}')
await mkdir(join(output,'assets'),{recursive:true});await writeFile(join(output,'assets/pixel.png'),await readFile(join(root,'tests/fixtures/assets/pixel.png')))
await writeFile(join(profile,'workspaces.json'),JSON.stringify({recent_workspaces:['\\\\?\\'+output],active_roots:['\\\\?\\'+output]}))
const env={...process.env,LIGHTEDIT_DEV_DATA_DIR:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9235',CARGO_NET_OFFLINE:'true'}
const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path')||'PATH';env[pathKey]=join(process.env.USERPROFILE,'.cargo/bin')+';'+env[pathKey]
const child=spawn(process.execPath,[join(root,'scripts/tauri.mjs'),'dev','--no-watch','--','--',file],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
let logs='',exitCode,browser,page,failure;child.stdout.on('data',value=>{logs+=value});child.stderr.on('data',value=>{logs+=value});child.on('exit',code=>{exitCode=code})
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),results=[],errors=[]
async function test(name,run){await run();results.push({name,result:'PASS'});console.log(`PASS ${name}`)}
const raw=()=>page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;return m.saveSnapshot(m.activeId)?.text})
try{
  const deadline=Date.now()+180000
  while(Date.now()<deadline){if(exitCode!==undefined)throw Error(`App exited ${exitCode}: ${logs.slice(-2000)}`);try{browser=await chromium.connectOverCDP('http://127.0.0.1:9235');break}catch{await pause(300)}}
  assert.ok(browser,'WebView2 CDP startup');for(let i=0;i<100;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://localhost:1420'));if(page)break;await pause(100)}assert.ok(page)
  page.on('pageerror',error=>errors.push(error.message));await page.locator('.md-prose').waitFor({timeout:30000})
  await test('native open/no-op modes/save retains original UTF-8 BOM and CRLF',async()=>{
    assert.equal(await raw(),original)
    for(const mode of ['source','split','live']){await page.evaluate(mode=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;m.setMarkdownMode(m.activeId,mode)},mode);if(mode==='live')await page.locator('.md-prose').waitFor();assert.equal(await raw(),original)}
    await page.evaluate(async()=>{const app=document.querySelector('#app').__vue_app__._instance.setupState;await app.files.save(app.manager.activeId)})
    assert.deepEqual(await readFile(file),Buffer.concat([bom,Buffer.from(original)]))
  })
  await test('native PM paragraph/table/code editing uses real Rust save with exact BOM/CRLF',async()=>{
    await page.locator('.md-prose h1').click();await page.keyboard.press('End');await page.keyboard.insertText('原生编辑')
    await page.locator('.md-prose td').filter({hasText:'内容'}).first().click();await page.keyboard.press('End');await page.keyboard.insertText('原生表格')
    await page.locator('.md-code-block .cm-content').first().click();await page.keyboard.press('Control+End');await page.keyboard.insertText('\n// 原生代码')
    const edited=await raw();assert.ok(edited.includes('原生编辑'));assert.ok(edited.includes('原生表格'));assert.ok(edited.includes('// 原生代码'));assert.ok(edited.includes('~~~~javascript extra-info\r\n'));assert.ok(!/(?<!\r)\n/.test(edited))
    await page.keyboard.press('Control+s');for(let i=0;i<50;i++){if((await readFile(file)).equals(Buffer.concat([bom,Buffer.from(edited)])))break;await pause(100)}assert.deepEqual(await readFile(file),Buffer.concat([bom,Buffer.from(edited)]))
  })
  await test('native shared undo across Source/Live and dirty-close protection',async()=>{
    const before=await raw();await page.locator('.md-prose h1').click();await page.keyboard.press('End');await page.keyboard.insertText('可撤销')
    await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;m.setMarkdownMode(m.activeId,'source');m.command('undo')});assert.equal(await raw(),before)
    await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;m.setMarkdownMode(m.activeId,'live');m.command('redo')});await page.locator('.md-prose').waitFor();assert.ok((await raw()).includes('可撤销'))
    const close=await page.evaluate(()=>{const app=document.querySelector('#app').__vue_app__._instance.setupState;return app.files.close(app.manager.activeId)});assert.equal(close,'dirty')
  })
  await test('native image NodeView uses authorized Rust bytes, keeps remote images closed and edits alt locally',async()=>{
    const image=page.locator('.md-image-preview img').first();await image.waitFor();assert.equal(await image.evaluate(img=>img.naturalWidth),1);assert.equal(await page.locator('img[src^="https:"]').count(),0)
    const before=await raw();await image.click();await page.getByLabel('图片替代文字').fill('原生替代文字');await page.getByRole('button',{name:'应用图片',exact:true}).click();assert.ok((await raw()).includes('![原生替代文字](./assets/pixel.png)'));assert.equal(await page.locator('.md-image-preview img').first().getAttribute('alt'),'原生替代文字')
    await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.command('undo'));assert.equal(await raw(),before)
  })
  await test('native external version conflict keeps disk bytes and dirty Live content',async()=>{
    const external=Buffer.concat([bom,Buffer.from(original+'\r\nexternal disk version')]);await writeFile(file,external)
    const edited=await raw();await page.evaluate(async()=>{const app=document.querySelector('#app').__vue_app__._instance.setupState;await app.files.save(app.manager.activeId)})
    assert.deepEqual(await readFile(file),external);assert.equal(await raw(),edited);assert.equal(await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.activeDocument.dirty),true)
  })
  await test('native app clipboard route pastes literal text into embedded code with controlled providers',async()=>{
    const before=await raw(),code=page.locator('.md-code-block .cm-content').first();await code.click();await page.keyboard.press('Control+End')
    await page.evaluate(async()=>{
      const clipboard=await import('/src/features/shell/clipboard.ts'),read=clipboard.textClipboard.readText,invoke=window.__TAURI_INTERNALS__.invoke
      clipboard.textClipboard.readText=async()=> '\n**literal paste** | 中文'
      window.__TAURI_INTERNALS__.invoke=(command,...args)=>command==='clipboard_image_files'?Promise.resolve([]):command.startsWith('plugin:clipboard-manager')?Promise.reject('not available'):invoke(command,...args)
      window.restoreTestClipboard=()=>{clipboard.textClipboard.readText=read;window.__TAURI_INTERNALS__.invoke=invoke}
    })
    try{await page.keyboard.press('Control+v');await page.waitForFunction(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;return m.getText(m.activeId).includes('**literal paste** | 中文')});assert.ok((await raw()).includes('**literal paste** | 中文'));await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.command('undo'));assert.equal(await raw(),before)}finally{await page.evaluate(()=>window.restoreTestClipboard?.())}
  })
  await page.screenshot({path:join(output,'native.png')});assert.deepEqual(errors,[])
}catch(error){failure=error;console.error(error);if(page)await page.screenshot({path:join(output,'failure.png')}).catch(()=>{})}
finally{
  await writeFile(join(output,'results.json'),JSON.stringify({results,errors,failure:failure?String(failure):null},null,2));await writeFile(join(output,'tauri.log'),logs)
  if(page)await page.evaluate(async()=>{const {getCurrentWindow}=await import('/node_modules/@tauri-apps/api/window.js');await getCurrentWindow().destroy()}).catch(()=>{})
  if(browser)await browser.close().catch(()=>{})
  if(exitCode===undefined)try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'})}catch{}
}
if(failure)process.exitCode=1
