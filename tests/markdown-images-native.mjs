import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdir,readFile,writeFile,readdir,rename} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createInterface} from 'node:readline'
const root=dirname(dirname(fileURLToPath(import.meta.url))),output=join(root,'test-results/markdown-images-native',String(Date.now()))
const profile=join(output,'profile'),folder=join(output,'single'),documentPath=join(folder,'中文 笔记.md'),sourcePath=join(output,'中文 图片 (1).png')
const {chromium}=createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE||import.meta.url)('playwright')
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
await Promise.all([mkdir(folder,{recursive:true}),mkdir(profile,{recursive:true})])
const png=await readFile(join(root,'tests/fixtures/assets/pixel.png'))
await Promise.all([writeFile(documentPath,'# Images\n\n'),writeFile(sourcePath,png),writeFile(join(profile,'editor-settings.json'),JSON.stringify({autoSave:false}))])
const env={...process.env,LIGHTEDIT_DEV_DATA_DIR:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9230',CARGO_NET_OFFLINE:'true'}
const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path')||'PATH';env[pathKey]=join(process.env.USERPROFILE,'.cargo/bin')+';'+env[pathKey]
// Unique identifier avoids single-instance routing into a user's installed app.
const child=spawn(process.execPath,[join(root,'scripts/tauri.mjs'),'dev','--config',JSON.stringify({identifier:'com.lightedit.images-native-fixture'}),'--no-watch','--','--',documentPath],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
let logs='',exitCode,browser,page,failure,clipboard,clipboardLog='',clipboardError='';const results=[],errors=[]
child.stdout.on('data',v=>{logs+=v});child.stderr.on('data',v=>{logs+=v});child.on('exit',code=>{exitCode=code})
const editor=()=>page.getByRole('textbox',{name:'文本编辑器',exact:true})
async function test(name,run){await run();results.push({name,result:'PASS'});console.log(`PASS ${name}`)}
async function clipboardMode(mode){const offset=clipboardLog.length;clipboard.stdin.write(mode+'\n');for(let i=0;i<100;i++){if(clipboardLog.slice(offset).includes('OK:'+mode))return;await pause(50)}throw Error('Clipboard helper: '+clipboardLog+clipboardError)}
async function text(){return page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.getText(document.querySelector('#app').__vue_app__._instance.setupState.manager.activeId))}
async function end(){await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;const n=m.getState(m.activeId).doc.length;m.dispatch(m.activeId,{selection:{anchor:n}});m.activeEditorView.focus()})}
try{
  const deadline=Date.now()+150000
  while(Date.now()<deadline){if(exitCode!==undefined)throw Error(`App exited ${exitCode}: ${logs.slice(-2000)}`);try{browser=await chromium.connectOverCDP('http://127.0.0.1:9230');break}catch{await pause(250)}}
  assert.ok(browser)
  for(let i=0;i<100;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://localhost:1420'));if(page)break;await pause(100)}
  assert.ok(page);page.on('pageerror',error=>errors.push(error.message))
  await page.getByRole('tab',{name:'中文 笔记.md',exact:true}).waitFor({timeout:20000})
  clipboard=spawn('powershell.exe',['-NoProfile','-STA','-File',join(root,'tests/image-clipboard-helper.ps1'),'-ImagePath',sourcePath],{windowsHide:true,stdio:['pipe','pipe','pipe']})
  createInterface({input:clipboard.stdout}).on('line',line=>{clipboardLog+=line+'\n'})
  clipboard.stderr.on('data',v=>{clipboardError+=v})
  for(let i=0;i<100&&!clipboardLog.includes('READY');i++)await pause(50)
  assert.ok(clipboardLog.includes('READY'),clipboardError)
  await test('Windows CF_HDROP keyboard paste copies real Chinese/space filename in single-file mode',async()=>{
    await clipboardMode('file');await end();await editor().press('Control+v')
    await page.waitForFunction(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.getText(document.querySelector('#app').__vue_app__._instance.setupState.manager.activeId).includes('![中文 图片 (1)]'))
    const imported=join(folder,'assets','中文 图片 (1).png');assert.deepEqual(await readFile(imported),png)
    assert.match(await text(),/\.\/assets\/%E4/)
    assert.equal(await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.workspace.roots.length),0)
    await page.waitForFunction(()=>[...document.querySelectorAll('.cm-md-image-block img')].some(img=>img.naturalWidth===1))
  })
  await test('Repeated file paste gets unique name and retains original bytes',async()=>{
    await end();await editor().press('Control+v')
    await page.waitForFunction(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.getText(document.querySelector('#app').__vue_app__._instance.setupState.manager.activeId).includes('%29-1.png'))
    assert.deepEqual(await readFile(join(folder,'assets','中文 图片 (1)-1.png')),png)
  })
  await test('Windows bitmap clipboard becomes a real PNG, not an unbacked path',async()=>{
    await clipboardMode('pixels');await end();await editor().press('Control+v')
    await page.waitForFunction(()=>/image-\d+\.png/.test(document.querySelector('#app').__vue_app__._instance.setupState.manager.getText(document.querySelector('#app').__vue_app__._instance.setupState.manager.activeId)))
    const files=await readdir(join(folder,'assets')),name=files.find(name=>/^image-\d+\.png$/.test(name));assert.ok(name)
    const bytes=await readFile(join(folder,'assets',name));assert.equal(bytes.subarray(1,4).toString(),'PNG')
  })
  await test('Ordinary text paste remains text in Markdown',async()=>{
    await clipboardMode('text');await end();await editor().press('Control+v')
    await page.waitForFunction(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.getText(document.querySelector('#app').__vue_app__._instance.setupState.manager.activeId).includes('clipboard plain text'))
  })
  await test('Settings global defaults and current document override persist outside Front Matter',async()=>{
    await page.locator('.topright button[title="设置"]').click()
    await page.getByRole('button',{name:'Markdown',exact:true}).click()
    assert.equal(await page.locator('#image-location').inputValue(),'assets')
    await page.locator('#image-scope').selectOption('document');await page.locator('#image-override').check()
    await page.locator('#image-location').selectOption('document');await page.getByRole('button',{name:'完成',exact:true}).click()
    for(let i=0;i<40;i++){try{const settings=JSON.parse(await readFile(join(profile,'editor-settings.json'),'utf8'));if(Object.values(settings.documentImageRules||{}).some(rule=>rule.location==='document'))break}catch{}await pause(100)}
    await clipboardMode('file');await end();await editor().press('Control+v')
    await page.waitForFunction(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.getText(document.querySelector('#app').__vue_app__._instance.setupState.manager.activeId).includes('.assets/'))
    assert.deepEqual(await readFile(join(folder,'中文 笔记.assets','中文 图片 (1).png')),png)
    assert.ok(!(await text()).includes('typora-copy-images-to'))
    await page.screenshot({path:join(output,'images-live.png')})
  })
  await test('Shared Source/Live/Split resolver, source navigation, and real save',async()=>{
    await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;m.setMarkdownMode(m.activeId,'split')})
    const image=page.getByRole('region',{name:'Markdown 只读预览'}).locator('img').first();await image.waitFor();await image.click()
    await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;m.setMarkdownMode(m.activeId,'source')})
    await editor().press('Control+s')
    const source=await text();for(let i=0;i<50;i++){if(await readFile(documentPath,'utf8')===source)break;await pause(100)}assert.equal(await readFile(documentPath,'utf8'),source)
    assert.equal(await page.locator('img[src^="https:"]').count(),0)
  })
  await test('Reopening moved Markdown and attachment tree preserves image preview',async()=>{
    await page.evaluate(()=>{const a=document.querySelector('#app').__vue_app__._instance.setupState; a.closeDocById(a.manager.activeId)})
    const moved=join(output,'moved');await rename(folder,moved)
    await page.evaluate(async path=>{const a=document.querySelector('#app').__vue_app__._instance.setupState;if(!await a.workspace.openWorkspacePath(path))throw Error('workspace open failed');const node=a.workspace.entries.find(node=>node.name==='中文 笔记.md');if(!node)throw Error('Markdown missing');await a.workspace.openFile(node,false);a.manager.setMarkdownMode(a.manager.activeId,'live')},moved)
    await page.waitForFunction(()=>[...document.querySelectorAll('.cm-md-image-block img')].some(img=>img.naturalWidth===1))
  })
  await test('Multiple workspace roots use the active Markdown directory for imports',async()=>{
    const second=join(output,'second');await mkdir(second);await writeFile(join(second,'second.md'),'# second\n\n')
    await page.evaluate(async path=>{const a=document.querySelector('#app').__vue_app__._instance.setupState;if(!await a.workspace.openWorkspacePath(path,true))throw Error('second root failed');const node=a.workspace.roots.find(root=>root.name==='second').entries.find(node=>node.name==='second.md');await a.workspace.openFile(node,false)},second)
    await clipboardMode('file');await end();await editor().press('Control+v')
    await page.waitForFunction(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.getText(document.querySelector('#app').__vue_app__._instance.setupState.manager.activeId).includes('![中文 图片 (1)]'))
    assert.deepEqual(await readFile(join(second,'assets','中文 图片 (1).png')),png)
    assert.equal(await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.workspace.roots.length),2)
  })
  assert.deepEqual(errors,[])
}catch(error){failure=String(error);console.error(failure);try{await page?.screenshot({path:join(output,'failure.png')})}catch{}}
finally{
  if(clipboard){clipboard.stdin.write('stop\n');for(let i=0;i<100&&!clipboardLog.includes('RESTORED');i++)await pause(50);if(!clipboardLog.includes('RESTORED')){failure ||= 'Clipboard restoration failed: '+clipboardError}}
  try{if(page&&browser?.isConnected())await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|destroy',{label:'main'}))}catch{}
  for(let i=0;i<30&&exitCode===undefined;i++)await pause(100)
  if(exitCode===undefined)child.kill()
  await writeFile(join(output,'native.log'),logs);await writeFile(join(output,'results.json'),JSON.stringify({results,errors,failure,realRustIPC:true,systemClipboardRestored:clipboardLog.includes('RESTORED'),physicalExplorerDrag:'NOT RUN',systemDialogs:'NOT RUN'},null,2))
  console.log(output)
}
if(failure)process.exitCode=1
