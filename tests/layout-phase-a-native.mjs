import assert from 'node:assert/strict'
import {spawn,execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=dirname(dirname(fileURLToPath(import.meta.url))),output=join(root,'test-results/layout-phase-a-native',String(Date.now()))
const profile=join(output,'profile'),paths=['a.txt','b.txt','c.txt'].map(name=>join(output,name))
const {chromium}=createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE||import.meta.url)('playwright')
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
assert.equal(execFileSync('powershell.exe',['-NoProfile','-Command','Get-Process lightedit -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id; exit 0'],{encoding:'utf8'}).trim(),'','Preserve user data: close existing LightEdit before isolated native test.')
await mkdir(profile,{recursive:true})
await writeFile(join(profile,'editor-settings.json'),JSON.stringify({autoSave:false}))
await Promise.all(paths.map((path,i)=>writeFile(path,`file ${i}\r\n中文`)))
const env={...process.env,LIGHTEDIT_DEV_DATA_DIR:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9231',CARGO_NET_OFFLINE:'true'}
const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path')||'PATH';env[pathKey]=join(process.env.USERPROFILE,'.cargo/bin')+';'+env[pathKey]
const child=spawn(process.execPath,[join(root,'scripts/tauri.mjs'),'dev','--no-watch','--','--',...paths],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
let logs='',exitCode,browser,page,failure,closed=false;const results=[],errors=[],diagnostics=[]
child.stdout.on('data',value=>{logs+=value});child.stderr.on('data',value=>{logs+=value});child.on('exit',code=>{exitCode=code})
const editor=()=>page.getByRole('textbox',{name:'文本编辑器',exact:true})
async function test(name,run){await run();results.push({name,result:'PASS'});console.log(`PASS ${name}`)}
async function dirtyDialog(source){
  if(source==='titlebar')await page.getByRole('button',{name:'关闭窗口',exact:true}).click()
  else if(source==='command') {await page.getByRole('menubar').getByRole('menuitem',{name:'文件',exact:true}).click();await page.getByRole('menuitem',{name:'退出',exact:true}).click()}
  else await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'}))
  await page.getByRole('dialog',{name:'未保存修改确认',exact:true}).waitFor()
}
try{
  const deadline=Date.now()+120000
  while(Date.now()<deadline){if(exitCode!==undefined)throw Error(`App exited ${exitCode}: ${logs.slice(-1600)}`);try{browser=await chromium.connectOverCDP('http://127.0.0.1:9231');break}catch{await pause(250)}}
  assert.ok(browser)
  for(let i=0;i<100;i++){page=browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().startsWith('http://localhost:1420'));if(page)break;await pause(100)}
  assert.ok(page);page.on('pageerror',error=>errors.push(error.message))
  page.on('console',async message=>{if(message.text().startsWith('[LightEdit close]')){const args=message.args();try{diagnostics.push(await args[1].jsonValue())}catch{}}})
  await page.getByRole('tab',{name:'c.txt',exact:true}).waitFor({timeout:15000})
  await test('Native three disk files / two panes / closing every tab leaves no editable orphan',async()=>{
    await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.splitEditor())
    await page.waitForFunction(()=>document.querySelectorAll('.cm-editor').length===2)
    for(const pane of ['main','secondary']){
      const buttons=page.locator(`.${pane}-pane .tab button.tinyclose`)
      while(await buttons.count())await buttons.first().click()
    }
    assert.equal(await page.locator('.cm-editor').count(),0)
    await page.locator('.secondary-pane .pane-empty').click({position:{x:15,y:15}})
    await page.keyboard.type('english');await page.keyboard.insertText('中文')
    assert.equal(await page.locator('.cm-editor').count(),0)
    assert.equal(await page.locator('.toast').count(),0)
    await page.locator('.secondary-pane .pane-empty').getByRole('button',{name:'快速打开',exact:true}).click()
    await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape')
    await page.locator('.secondary-pane .pane-empty').getByRole('button',{name:'新建文件',exact:true}).click()
    await editor().fill('保留内容')
  })
  await test('Native titlebar, command and native close share one dirty confirmation, cancel retains content',async()=>{
    for(const source of ['titlebar','command','native']){
      await dirtyDialog(source);await page.getByRole('button',{name:'继续编辑',exact:true}).click()
      assert.equal(await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;return m.getText(m.activeId)}),'保留内容')
    }
    for(const source of ['titlebar','command','native'])assert.ok(diagnostics.some(d=>d.source===source&&d.stage==='confirm-dirty'),`diagnostic source ${source}`)
    assert.equal(diagnostics.filter(d=>d.stage==='confirm-dirty').length,3)
  })
  await test('Save conflict during native save-and-close retains dirty content and window',async()=>{
    await page.locator('.secondary-pane .tab button.tinyclose').click()
    await page.getByRole('button',{name:'放弃修改并关闭',exact:true}).click()
    await page.evaluate(async path=>{const s=document.querySelector('#app').__vue_app__._instance.setupState;await s.openRecent(path)},'\\\\?\\'+paths[0])
    await editor().fill('unsaved changes中文')
    await writeFile(paths[0],'external conflict\r\n')
    await dirtyDialog('titlebar');await page.getByRole('button',{name:'保存并关闭',exact:true}).click()
    await page.waitForFunction(()=>document.querySelector('.toast')?.textContent.includes('磁盘'))
    assert.equal(await readFile(paths[0],'utf8'),'external conflict\r\n')
    assert.equal(await page.getByRole('dialog',{name:'未保存修改确认',exact:true}).count(),1)
    await page.getByRole('button',{name:'继续编辑',exact:true}).click()
    assert.equal(await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.activeDocument.dirty),true)
  })
  await test('After closing all tabs, typing into empty space does not prevent real native window close',async()=>{
    await page.locator('.secondary-pane .tab button.tinyclose').click();await page.getByRole('button',{name:'放弃修改并关闭',exact:true}).click()
    assert.equal(await page.locator('.cm-editor').count(),0)
    await page.locator('.main-pane .pane-empty').click({position:{x:10,y:10}});await page.keyboard.type('abc');await page.keyboard.insertText('中文')
    await page.screenshot({path:join(output,'empty-native.png')})
    const close=page.waitForEvent('close',{timeout:10000})
    await page.getByRole('button',{name:'关闭窗口',exact:true}).click();await close;closed=true
  })
  assert.deepEqual(errors,[])
}catch(error){failure=String(error);console.error(failure);try{await page?.screenshot({path:join(output,'failure.png')})}catch{}}
finally{
  try{if(!closed&&page&&browser?.isConnected())await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|destroy',{label:'main'}))}catch{}
  for(let i=0;i<30&&exitCode===undefined;i++)await pause(100)
  if(exitCode===undefined)child.kill()
  await writeFile(join(output,'native.log'),logs)
  await writeFile(join(output,'results.json'),JSON.stringify({results,errors,diagnostics,failure,realRustIPC:true,realSystemIME:'NOT RUN (CDP insertText is not a Windows input method)'},null,2))
}
if(failure)process.exitCode=1
