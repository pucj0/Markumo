import assert from 'node:assert/strict'
import {spawn,execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setMarkdownMode} from './menu-helpers.mjs'
const root=dirname(dirname(fileURLToPath(import.meta.url))),output=join(root,'test-results/markdown-stage-a-native',String(Date.now()))
const workspace=join(output,'workspace'),profile=join(output,'profile'),documentPath=join(workspace,'docs/stage-a.md')
const {chromium}=createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE||import.meta.url)('playwright')
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
assert.equal(execFileSync('powershell.exe',['-NoProfile','-Command','Get-Process lightedit -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id; exit 0'],{encoding:'utf8'}).trim(),'','Preserve user data: save and close existing LightEdit first.')
await Promise.all([mkdir(join(workspace,'docs/assets'),{recursive:true}),mkdir(profile,{recursive:true})])
const original=(await readFile(join(root,'tests/fixtures/markdown-stage-a.md'),'utf8')).replace(/\r?\n/g,'\r\n')
const source=original.replace(/\r\n/g,'\n'),bom=Buffer.from([0xef,0xbb,0xbf])
const pixel=await readFile(join(root,'tests/fixtures/assets/pixel.png'))
await Promise.all([writeFile(documentPath,Buffer.concat([bom,Buffer.from(original)])),writeFile(join(workspace,'docs/assets/pixel.png'),pixel),writeFile(join(output,'outside.png'),pixel),writeFile(join(workspace,'docs/assets/unsafe.svg'),'<svg onload="bad()"/>')])
const canonical=path=>'\\\\?\\'+path
await writeFile(join(profile,'workspaces.json'),JSON.stringify({recent_workspaces:[canonical(workspace)],active_roots:[canonical(workspace)]}))
await writeFile(join(profile,'editor-settings.json'),JSON.stringify({autoSave:false}))
const env={...process.env,LIGHTEDIT_DEV_DATA_DIR:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9230',CARGO_NET_OFFLINE:'true'}
const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path')||'PATH';env[pathKey]=join(process.env.USERPROFILE,'.cargo/bin')+';'+env[pathKey]
const child=spawn(process.execPath,[join(root,'scripts/tauri.mjs'),'dev','--no-watch','--','--',documentPath],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
let logs='',exitCode,browser,page,failure;const results=[],errors=[]
child.stdout.on('data',value=>{logs+=value});child.stderr.on('data',value=>{logs+=value});child.on('exit',code=>{exitCode=code})
const editor=()=>page.getByRole('textbox',{name:'文本编辑器',exact:true})
async function test(name,run){await run();results.push({name,result:'PASS'});console.log(`PASS ${name}`)}
async function waitDisk(expected){for(let i=0;i<50;i++){if((await readFile(documentPath)).equals(expected))return;await pause(100)}assert.deepEqual(await readFile(documentPath),expected)}
try{
  const deadline=Date.now()+120000
  while(Date.now()<deadline){if(exitCode!==undefined)throw Error(`App exited ${exitCode}: ${logs.slice(-1600)}`);try{browser=await chromium.connectOverCDP('http://127.0.0.1:9230');break}catch{await pause(250)}}
  assert.ok(browser)
  for(let i=0;i<100;i++){page=browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().startsWith('http://localhost:1420'));if(page)break;await pause(100)}
  assert.ok(page);page.on('pageerror',error=>errors.push(error.message))
  await page.getByRole('tab',{name:'stage-a.md',exact:true}).waitFor({timeout:15000})
  await test('Scoped local image: real Rust binary response, WebView2 blob decode, missing path fallback',async()=>{
    await page.waitForFunction(()=>document.querySelector('#app').__vue_app__._instance.setupState.workspace.roots.length===1)
    await page.evaluate(position=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;const line=m.getState(m.activeId).doc.lineAt(position).number;m.revealPosition(m.activeId,line+1,1)},source.indexOf('![相对路径图片]'))
    await page.waitForFunction(()=>[...document.querySelectorAll('.cm-md-image-block img')].some(image=>image.naturalWidth===1))
    const bytes=await page.evaluate(async()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;const bytes=await window.__TAURI_INTERNALS__.invoke('read_markdown_image',{token:m.activeDocument.fileToken,relative:'./assets/pixel.png'});return Array.from(new Uint8Array(bytes))})
    assert.deepEqual(Buffer.from(bytes),pixel)
    await page.waitForFunction(()=>[...document.querySelectorAll('.md-image-preview')].some(node=>node.textContent.includes('missing.png')&&node.textContent.includes('图片未显示')))
    assert.equal(await page.locator('img[src^="https:"]').count(),0)
  })
  await test('Rust rejects outside workspace, arbitrary file URLs and active SVG',async()=>{
    const denied=await page.evaluate(async()=>{const token=document.querySelector('#app').__vue_app__._instance.setupState.manager.activeDocument.fileToken;const result=[];for(const relative of ['../../outside.png','file:///C:/secret.png','./assets/unsafe.svg']){try{await window.__TAURI_INTERNALS__.invoke('read_markdown_image',{token,relative});result.push('UNEXPECTED')}catch(error){result.push(error.code)}}return result})
    assert.deepEqual(denied,['image_scope','image_scope','image_format'])
  })
  await test('Real image click/edit/undo/redo/save retains BOM and CRLF bytes',async()=>{
    await page.locator('.cm-md-image-block img').first().click()
    const from=source.indexOf('![相对路径图片]')
    assert.equal(await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.activeEditorView.state.selection.main.head),from)
    await page.keyboard.insertText('测');await editor().press('Control+s')
    const edited=source.slice(0,from)+'测'+source.slice(from)
    await waitDisk(Buffer.concat([bom,Buffer.from(edited.replace(/\n/g,'\r\n'))]))
    await editor().press('Control+z');await editor().press('Control+y');await editor().press('Control+z');await editor().press('Control+s')
    await waitDisk(Buffer.concat([bom,Buffer.from(original)]))
  })
  await test('Native Live/Source/Split switching and real preview image source navigation',async()=>{
    for(const mode of ['source','split','live','source','split']){await setMarkdownMode(page,mode);assert.equal(await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;return m.saveSnapshot(m.activeId).text}),original)}
    const region=page.getByRole('region',{name:'Markdown 只读预览'})
    const image=region.locator('img').first();await image.waitFor();await image.scrollIntoViewIfNeeded();await image.click()
    assert.equal(await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.activeEditorView.state.selection.main.head),source.indexOf('![相对路径图片]'))
    await page.screenshot({path:join(output,'native-images.png')})
  })
  assert.deepEqual(errors,[])
}catch(error){failure=String(error);console.error(failure);try{await page?.screenshot({path:join(output,'failure.png')})}catch{}}
finally{
  try{if(page&&browser?.isConnected())await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|destroy',{label:'main'}))}catch{}
  for(let i=0;i<30&&exitCode===undefined;i++)await pause(100)
  if(exitCode===undefined)child.kill()
  await writeFile(join(output,'native.log'),logs);await writeFile(join(output,'results.json'),JSON.stringify({results,errors,failure,realRustIPC:true,realSystemIME:'NOT RUN'},null,2))
}
if(failure)process.exitCode=1
