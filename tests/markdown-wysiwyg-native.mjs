import assert from 'node:assert/strict'
import {spawn,execFileSync} from 'node:child_process'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=dirname(dirname(fileURLToPath(import.meta.url))),output=join(root,'test-results/markdown-wysiwyg-native',String(Date.now())),profile=join(output,'profile'),file=join(output,'writing.md')
import { chromium } from 'playwright'
// A separate Tauri identifier prevents routing test files into the installed editor.
assert.equal(execFileSync('powershell.exe',['-NoProfile','-Command','Get-Process markumo -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id; exit 0'],{encoding:'utf8'}).trim(),'','Preserve running Markumo sessions: another process is active.')
await mkdir(profile,{recursive:true});const fixture=await readFile(join(root,'tests/fixtures/markdown-wysiwyg.md'),'utf8'),original=fixture.replace(/\r?\n/g,'\r\n'),bom=Buffer.from([239,187,191]);await writeFile(file,Buffer.concat([bom,Buffer.from(original)]));await writeFile(join(profile,'editor-settings.json'),'{}')
await mkdir(join(output,'assets'),{recursive:true});await writeFile(join(output,'assets/pixel.png'),await readFile(join(root,'tests/fixtures/assets/pixel.png')))
await writeFile(join(profile,'workspaces.json'),JSON.stringify({recent_workspaces:['\\\\?\\'+output],active_roots:['\\\\?\\'+output]}))
const env={...process.env,LIGHTEDIT_DEV_DATA_DIR:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9235',CARGO_NET_OFFLINE:'true'}
const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path')||'PATH';env[pathKey]=join(process.env.USERPROFILE,'.cargo/bin')+';'+env[pathKey]
const child=spawn(process.execPath,[join(root,'scripts/tauri.mjs'),'dev','--no-watch','--config',JSON.stringify({identifier:'com.markumo.test.wysiwyg'}),'--','--',file],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
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
    await page.locator('.md-diagram svg').waitFor({timeout:60000})
    await page.locator('.md-inline-math .katex').waitFor()
    await page.locator('.md-math-output .katex-display').waitFor()
    assert.equal(await page.locator('.md-code-block').filter({has:page.locator('.md-diagram svg')}).locator('.md-code-editor-wrap').isVisible(),false)
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
    const before=await raw();await image.click({button:'right'});await page.getByLabel('图片替代文字').fill('原生替代文字');await page.getByRole('button',{name:'应用图片',exact:true}).click();assert.ok((await raw()).includes('![原生替代文字](./assets/pixel.png)'));assert.equal(await page.locator('.md-image-preview img').first().getAttribute('alt'),'原生替代文字')
    await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.command('undo'));assert.equal(await raw(),before)
  })
  await test('native image property target maps pane edits and rejects stale deletion handlers',async()=>{
    await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;m.focusPane('main',false);m.splitEditor()})
    await page.waitForFunction(()=>document.querySelectorAll('.md-prose').length===2)
    const main=page.locator('.main-pane'),before=await raw()
    await main.locator('.md-live-image img').first().click({button:'right'})
    await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager,v=[...m.liveViews.entries()].find(([p])=>p!=='main')[1].editor.view;v.dispatch(v.state.tr.insertText('远端',v.state.doc.child(0).nodeSize+1))})
    await main.getByLabel('图片替代文字').fill('映射正确')
    await main.getByRole('button',{name:'应用图片',exact:true}).click()
    assert.ok((await raw()).includes('![映射正确]'))
    await main.locator('.md-live-image img').first().click({button:'right'})
    await page.evaluate(()=>{
      window.staleNativeImageDelete=[...document.querySelectorAll('.main-pane .md-properties button')].find(b=>b.textContent==='删除图片').onclick
      const m=document.querySelector('#app').__vue_app__._instance.setupState.manager,v=[...m.liveViews.entries()].find(([p])=>p!=='main')[1].editor.view
      let pos;v.state.doc.descendants((node,at)=>{if(pos===undefined&&node.type.name==='image')pos=at})
      v.dispatch(v.state.tr.setNodeMarkup(pos,undefined,{...v.state.doc.nodeAt(pos).attrs,alt:'远端改图'}))
    })
    assert.equal(await main.locator('.md-properties').isVisible(),false)
    const changed=await raw();await page.evaluate(()=>window.staleNativeImageDelete(new MouseEvent('click')));assert.equal(await raw(),changed)
    await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;m.focusPane('main',false);m.command('undo');m.command('undo');m.command('undo');m.mergeAllPanes()})
    assert.equal(await raw(),before)
    await page.waitForFunction(()=>document.querySelectorAll('.md-prose').length===1)
  })
  await test('native HTML local CM, precise image end, default border, shared undo and Rust preference persistence',async()=>{
    const before=await raw(),text='before\n\n![中文](./assets/pixel.png "title")\n\n<h1 data-title="属性">HTML 标题</h1>\n\nafter'
    await page.evaluate(text=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;m.dispatch(m.activeId,{changes:{from:0,to:m.getState(m.activeId).doc.length,insert:text}})},text)
    const image=page.locator('.md-live-image img').first();await image.waitFor();await page.waitForFunction(()=>document.querySelector('.md-live-image img')?.naturalWidth)
    assert.equal(await image.evaluate(img=>getComputedStyle(img).borderTopWidth),'1px');await image.click()
    const selected=await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager,e=m.liveViews.get('main').editor.inlineSource;return {selection:m.getState(m.activeId).selection.main.head,end:e.sourceTo,native:e.selection(),length:e.input.textContent.length}})
    assert.equal(selected.selection,selected.end);assert.equal(selected.native.head,selected.length);assert.equal(selected.native.anchor,selected.length)
    await page.locator('.md-html-preview h1').click();const local=page.getByRole('textbox',{name:'HTML 局部源码'});await local.click();await page.keyboard.press('Control+a');await page.keyboard.insertText('<h1 data-title="属性">本地编辑</h1>');assert.ok((await raw()).includes('本地编辑'))
    await page.keyboard.press('Escape');assert.equal(await local.count(),0);assert.equal(await page.locator('.md-html-preview h1').innerText(),'本地编辑')
    await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.command('undo'));assert.ok((await raw()).includes('HTML 标题'))
    const preferences=await page.evaluate(async()=>{const invoke=window.__TAURI_INTERNALS__.invoke,s=await invoke('load_editor_settings');const original=s.markdownTypography.imageBorder;s.markdownTypography.imageBorder=false;await invoke('save_editor_settings',{settings:s});const loaded=await invoke('load_editor_settings');return {original,saved:loaded.markdownTypography.imageBorder}})
    assert.equal(preferences.original,true);assert.equal(preferences.saved,false)
    await page.screenshot({path:join(output,'native-html-image.png')})
    await page.evaluate(text=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;m.dispatch(m.activeId,{changes:{from:0,to:m.getState(m.activeId).doc.length,insert:text}})},before)
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
