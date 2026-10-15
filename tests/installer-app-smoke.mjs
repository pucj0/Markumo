import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setMarkdownMode } from './menu-helpers.mjs'
let chromium
try {
  const req = createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE || import.meta.url)
  chromium = req('playwright').chromium
} catch {
  // Playwright not installed in environment
}
const executable=process.env.LIGHTEDIT_INSTALL_TEST_EXE, output=process.env.LIGHTEDIT_INSTALL_TEST_OUTPUT
assert.ok(executable && output)
const fixture=join(output,'安装验证.md'), source='# 安装验证\r\n\r\n| 左 | 右 |\r\n| :--- | ---: |\r\n| 1 | **中文** |\r\n\r\n中文与 emoji 🚀，无需开发服务器'
const bytes=text=>Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(text)])
await writeFile(fixture,bytes(source),{flag:'wx'})
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)), results=[], errors=[]

if (!chromium) {
  console.log('[INFO] Playwright is not installed. Performing direct binary launch and file argument test.')
  const child = spawn(executable, [fixture], { windowsHide: true, stdio: 'ignore' })
  await pause(3000)
  assert.equal(child.exitCode, null, 'Executable must launch and keep running with file argument')
  child.kill()
  results.push({ name: 'Installed executable launched with file argument (Playwright CDP smoke NOT RUN)', result: 'PASS' })
  await writeFile(join(output, 'app-results.json'), JSON.stringify({ results, errors: [], playwright: false }, null, 2))
  process.exit(0)
}
let child,browser,page,exitCode, failure
async function launch() {
  exitCode=undefined
  child=spawn(executable,[fixture],{windowsHide:true,stdio:'pipe',env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:join(output,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9233'}})
  child.on('error',error=>errors.push(String(error)));child.on('exit',code=>{exitCode=code})
  const deadline=Date.now()+90000
  while(Date.now()<deadline) {
    if(exitCode!==undefined) throw new Error(`Installed app exited ${exitCode}`)
    try {browser=await chromium.connectOverCDP('http://127.0.0.1:9233');break} catch {await pause(200)}
  }
  assert.ok(browser,'installed release opens WebView2')
  for(let i=0;i<100;i++) {page=browser.contexts().flatMap(context=>context.pages()).find(p=>/^(https?:\/\/tauri\.localhost|tauri:\/\/localhost)/.test(p.url()));if(page)break;await pause(100)}
  assert.ok(page,'release must load bundled assets, not localhost:1420')
  page.on('pageerror',error=>errors.push(error.message))
  await page.getByRole('tab',{name:/安装验证.md/}).waitFor({timeout:30000})
}
const editor=()=>page.locator('.main-pane .cm-content')
async function settings() {await page.getByTitle('设置',{exact:true}).click()}
async function done() {await page.getByRole('button',{name:'完成',exact:true}).click();await page.locator('.settingsoverlay').waitFor({state:'hidden'})}
async function diskEquals(text) {
  for(let i=0;i<80;i++) {if((await readFile(fixture)).equals(bytes(text)))return;await pause(100)}
  assert.deepEqual(await readFile(fixture),bytes(text),'real installed executable must save expected bytes')
}
async function closeClean() {
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click()
  for(let i=0;i<100&&exitCode===undefined;i++)await pause(100)
  assert.equal(exitCode,0,'normal close handshake exits installed app')
  await browser.close();browser=undefined;page=undefined
}
try {
  await launch()
  assert.equal(await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_app_version')),'0.1.0')
  for(const name of ['文件','编辑','格式','视图','工作区','帮助'])assert.equal(await page.getByRole('menubar').getByRole('menuitem',{name,exact:true}).isVisible(),true)
  assert.equal(await page.locator('.kernel-notice').count(),0)
  results.push({name:'真实安装后的release exe加载内嵌前端/菜单/版本，无Vite服务',result:'PASS',url:page.url()})
  await settings();await page.getByLabel('自动保存',{exact:true}).uncheck();await page.getByLabel('编辑器字号',{exact:true}).fill('17');await page.getByLabel('颜色主题',{exact:true}).selectOption('light');await done()
  await setMarkdownMode(page,'源码')
  assert.equal(await editor().innerText(),source.replaceAll('\r\n','\n'))
  await editor().focus();await editor().press('Control+End');await page.keyboard.insertText(' · 手动保存')
  await editor().press('Control+s');await diskEquals(source+' · 手动保存')
  results.push({name:'真实打开/编辑/Ctrl+S保存，BOM/CRLF/中文/emoji无损',result:'PASS'})
  await setMarkdownMode(page,'即时排版')
  await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;m.dispatch(m.activeId,{selection:{anchor:0}})})
  const cell=page.locator('.cm-md-table tr').last().locator('td').first();await cell.waitFor()
  const position=Number(await cell.getAttribute('data-source-from'));await cell.click()
  assert.equal(await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.view.state.selection.main.head),position)
  await page.keyboard.insertText('发布表格');await editor().press('Control+s')
  await diskEquals((source+' · 手动保存').replace('| 1 |','| 发布表格1 |'))
  await editor().press('Control+z');await editor().press('Control+s');await diskEquals(source+' · 手动保存')
  await setMarkdownMode(page,'源码')
  await page.evaluate(()=>window.releaseNoRefresh=true);await editor().press('Control+r');assert.equal(await page.locator('input[name=replace]').isVisible(),true);assert.equal(await page.evaluate(()=>window.releaseNoRefresh),true);await page.locator('input[name=replace]').press('Escape')
  results.push({name:'安装后的表格真实点击/编辑/撤销/磁盘保存，Ctrl+R不刷新',result:'PASS'})
  await settings();await page.getByLabel('自动保存',{exact:true}).check();await page.getByLabel('自动保存延迟',{exact:true}).selectOption('500');await done()
  await editor().focus();await editor().press('Control+End');await page.keyboard.insertText(' · 自动保存')
  await diskEquals(source+' · 手动保存 · 自动保存')
  await page.waitForFunction(()=>!document.querySelector('.tab.active .unsaved'))
  results.push({name:'安装后自动保存真实落盘、dirty正确清除',result:'PASS'})
  await settings();await page.getByLabel('自动保存',{exact:true}).uncheck();await done()
  await editor().focus();await editor().press('Control+n');await page.keyboard.insertText('安装测试草稿')
  const draft=await page.locator('.tab.active .filename').innerText()
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click();await page.getByRole('dialog',{name:'未保存修改确认',exact:true}).waitFor()
  await page.getByRole('button',{name:'继续编辑',exact:true}).click();assert.equal(await editor().innerText(),'安装测试草稿')
  await page.getByRole('button',{name:`关闭 ${draft}`,exact:true}).click();await page.getByRole('button',{name:'放弃修改并关闭',exact:true}).click()
  results.push({name:'安装后关闭保护保留草稿，明确放弃仅移除测试草稿',result:'PASS'})
  await page.screenshot({path:join(output,'installed-app.png')})
  await closeClean();await launch()
  await settings();assert.equal(await page.getByLabel('编辑器字号',{exact:true}).inputValue(),'17');assert.equal(await page.getByLabel('自动保存',{exact:true}).isChecked(),false);assert.equal(await page.getByLabel('颜色主题',{exact:true}).inputValue(),'light');await done()
  assert.equal(await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.activeDocument.mode),'source')
  assert.deepEqual(errors,[]);await closeClean()
  results.push({name:'真实退出/重启恢复设置与文件模式',result:'PASS'})
  console.log(`PASS ${results.length} installed release smoke groups`)
} catch(error) {failure=String(error);console.error(failure);if(page)await page.screenshot({path:join(output,'failure.png')}).catch(()=>{})}
finally {
  // Only terminate the process created by this script, never an unrelated window.
  if(exitCode===undefined && child) {if(page)await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|destroy',{label:'main'})).catch(()=>{});for(let i=0;i<30&&exitCode===undefined;i++)await pause(100);if(exitCode===undefined)child.kill()}
  if(browser)await browser.close().catch(()=>{})
  await writeFile(join(output,'app-results.json'),JSON.stringify({results,errors,failure:failure||null},null,2))
}
if(failure)process.exitCode=1
