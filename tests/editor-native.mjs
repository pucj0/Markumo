import {setMarkdownMode,splitPaneViaMenu,mergePanesViaMenu} from './menu-helpers.mjs'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile, unlink, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkSelection } from './selection-checks.mjs'
import { checkMarkdownClicks } from './markdown-click-checks.mjs'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const output = join(root, 'test-results/editor-native', String(Date.now()))
const profile = join(output, 'profile')
// Optional explicitly selected directory exercises permissions outside the repo.
// Always create a new dedicated child directory; never edit an existing user file.
const fixtureDirectory = process.env.LIGHTEDIT_TEST_FIXTURE_DIR ? join(process.env.LIGHTEDIT_TEST_FIXTURE_DIR, `lightedit-save-test-${Date.now()}`) : output
const fixture = join(fixtureDirectory, 'complex.md')
const { chromium } = createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE || import.meta.url)('playwright')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const pids = () => execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Process lightedit,markumo -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id; exit 0'], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean)
assert.deepEqual(pids(), [], 'Save and close existing LightEdit before this isolated native test.')
await mkdir(output, { recursive: true })
if (process.env.LIGHTEDIT_TEST_FIXTURE_DIR) await mkdir(fixtureDirectory)
const original = '# 中文标题\r\n\r\n**bold** 和 ``code ` inside``\r\n- [ ] task\r\n> quote\r\n\r\n```js\r\nconst x = 1\r\n```\r\n\r\n| a | b |\r\n| - | - |\r\n| 1 | 2 |'
const bom = Buffer.from([0xef, 0xbb, 0xbf])
await writeFile(fixture, Buffer.concat([bom, Buffer.from(original)]), { flag: 'wx' })
const env = { ...process.env, LIGHTEDIT_DEV_DATA_DIR: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9227', CARGO_NET_OFFLINE: 'true' }
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH'
env[pathKey] = join(process.env.USERPROFILE, '.cargo/bin') + ';' + env[pathKey]
let child, logs = '', exitCode, browser, page, failure
function launch() {
  exitCode=undefined
  child = spawn(process.execPath, [join(root, 'scripts/tauri.mjs'), 'dev', '--no-watch', '--', '--', fixture], { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdout.on('data', value => { logs += value }); child.stderr.on('data', value => { logs += value })
  child.on('exit', code => { exitCode = code })
}
launch()
const results = [], errors = []
const editor = () => page.getByRole('textbox', { name: '文本编辑器', exact: true })
async function raw() { return page.evaluate(() => { const manager = document.querySelector('#app').__vue_app__._instance.setupState.manager; return manager.saveSnapshot(manager.activeId).text }) }
async function test(name, callback) { await callback(); results.push({ name, result: 'PASS' }); console.log(`PASS ${name}`) }
async function connect() {
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    if (exitCode !== undefined) throw new Error(`CLI exited ${exitCode}: ${logs.slice(-1800)}`)
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9227'); break } catch { await pause(250) }
  }
  assert.ok(browser)
  for(let i=0;i<100;i++) {
    page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://localhost:1420'))
    if(page) break
    await pause(100)
  }
  assert.ok(page);page.on('pageerror',e=>errors.push(e.message))
  await page.getByRole('tab',{name:/complex.md/}).waitFor({timeout:15000})
}
try {
  await connect()
  await test('自动保存：默认关闭、手动开启后真实BOM/CRLF写入、关闭/重启设置、外部冲突保留并暂停',async()=>{
    await setMarkdownMode(page,'源码')
    const filePath=await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;return m.activeDocument.path})
    assert.equal(await page.locator('.kernel-notice,.sidefoot').count(),0)
    // Opt-in: the profile is fresh, so editing must not touch the disk.
    await editor().focus();await editor().press('Control+End');await page.keyboard.insertText('暂不自动写入')
    await pause(2200);assert.deepEqual(await readFile(fixture),Buffer.concat([bom,Buffer.from(original)]))
    assert.equal(await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.activeDocument.dirty),true)
    // A manual save still works while automatic save is off.
    await editor().press('Control+s')
    for(let i=0;i<50;i++){if((await readFile(fixture)).equals(Buffer.concat([bom,Buffer.from(original+'暂不自动写入')])))break;await pause(100)}
    assert.deepEqual(await readFile(fixture),Buffer.concat([bom,Buffer.from(original+'暂不自动写入')]))
    await page.waitForFunction(()=>!document.querySelector('#app').__vue_app__._instance.setupState.manager.activeDocument.dirty)
    await page.getByTitle('设置',{exact:true}).click()
    assert.equal(await page.getByLabel('自动保存',{exact:true}).isChecked(),false)
    await page.getByLabel('自动保存',{exact:true}).check();await page.getByLabel('自动保存延迟',{exact:true}).selectOption('500')
    await page.getByLabel('编辑器字号',{exact:true}).fill('18');await page.getByLabel('编辑器字号',{exact:true}).blur()
    assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--editor-size')),'18px')
    await page.getByLabel('编辑器字号',{exact:true}).fill('14');await page.getByRole('button',{name:'完成',exact:true}).click()
    await editor().focus();await editor().press('Control+End');await page.keyboard.insertText('自动保存中文')
    for(let i=0;i<50;i++){if((await readFile(fixture)).equals(Buffer.concat([bom,Buffer.from(original+'暂不自动写入自动保存中文')])))break;await pause(100)}
    assert.deepEqual(await readFile(fixture),Buffer.concat([bom,Buffer.from(original+'暂不自动写入自动保存中文')]))
    await page.waitForFunction(()=>!document.querySelector('#app').__vue_app__._instance.setupState.manager.activeDocument.dirty)
    assert.equal(await page.locator('.toast').count(),0)
    await page.getByTitle('设置',{exact:true}).click();await page.getByLabel('自动保存',{exact:true}).uncheck();await page.getByRole('button',{name:'完成',exact:true}).click()
    await editor().focus();await editor().press('Control+End');await page.keyboard.insertText('暂不保存')
    await pause(1800);assert.deepEqual(await readFile(fixture),Buffer.concat([bom,Buffer.from(original+'暂不自动写入自动保存中文')]))
    await page.getByTitle('设置',{exact:true}).click();await page.getByLabel('自动保存',{exact:true}).check();await page.getByLabel('自动保存延迟',{exact:true}).selectOption('500');await page.getByRole('button',{name:'完成',exact:true}).click()
    for(let i=0;i<30;i++){if((await readFile(fixture)).equals(Buffer.concat([bom,Buffer.from(original+'暂不自动写入自动保存中文暂不保存')])))break;await pause(100)}
    assert.deepEqual(await readFile(fixture),Buffer.concat([bom,Buffer.from(original+'暂不自动写入自动保存中文暂不保存')]))
    const external=Buffer.concat([bom,Buffer.from(original+'外部修改')]);await writeFile(fixture,external)
    await editor().focus();await editor().press('Control+End');await page.keyboard.insertText('冲突保留')
    await page.waitForFunction(()=>document.querySelector('.toast')?.textContent.includes('自动保存已暂停'))
    await page.keyboard.insertText('继续编辑');await pause(1600)
    assert.deepEqual(await readFile(fixture),external);assert.equal(await raw(),original+'暂不自动写入自动保存中文暂不保存冲突保留继续编辑')
    assert.equal(await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.activeDocument.dirty),true)
    await page.getByTitle('设置',{exact:true}).click();await page.getByLabel('自动保存延迟',{exact:true}).selectOption('1500');await page.getByLabel('自动保存',{exact:true}).uncheck();await page.getByRole('button',{name:'完成',exact:true}).click()
    await page.getByRole('button',{name:'关闭 complex.md',exact:true}).click();await page.getByRole('button',{name:'放弃修改并关闭',exact:true}).click()
    await writeFile(fixture,Buffer.concat([bom,Buffer.from(original)]))
    // Restore only our fixture via its real, already authorized recent-file IPC.
    await page.evaluate(async path=>{const f=await window.__TAURI_INTERNALS__.invoke('open_recent',{path,encoding:null});document.querySelector('#app').__vue_app__._instance.setupState.manager.openFile(f)},filePath)
    await page.getByRole('tab',{name:/complex.md/}).waitFor();assert.equal(await raw(),original)
    await pause(300);const settings=JSON.parse(await readFile(join(profile,'editor-settings.json'),'utf8'));assert.equal(settings.autoSave,false)
    await page.screenshot({path:join(output,'quiet-editor.png')})
  })
  await test('自定义标题栏：无系统装饰、最大化/还原、关闭未保存保护',async()=>{
    assert.equal(await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|is_decorated',{label:'main'})),false)
    assert.equal(await page.locator('.app-brand .brand').innerText(),'Markumo')
    await page.getByRole('button',{name:'最大化或还原窗口',exact:true}).click()
    await page.waitForFunction(async()=>await window.__TAURI_INTERNALS__.invoke('plugin:window|is_maximized',{label:'main'}))
    await page.getByRole('button',{name:'最大化或还原窗口',exact:true}).click()
    await page.waitForFunction(async()=>!await window.__TAURI_INTERNALS__.invoke('plugin:window|is_maximized',{label:'main'}))
    await setMarkdownMode(page,'源码');await editor().click();await editor().press('Control+End');await page.keyboard.insertText('dirty-titlebar')
    for(const source of ['button','menu']) {
      if(source==='button') await page.getByRole('button',{name:'关闭窗口',exact:true}).click()
      else { await page.locator('[role=menubar]').getByRole('menuitem',{name:'文件',exact:true}).click();await page.getByRole('menuitem',{name:'退出',exact:true}).click() }
      await page.getByRole('dialog',{name:'未保存修改确认',exact:true}).waitFor()
      await page.getByRole('button',{name:'继续编辑',exact:true}).click()
    }
    await editor().focus();await editor().press('Control+z');assert.equal(await raw(),original)
  })
  await test('菜单与字号：真实 Markdown 格式、Ctrl+滚轮、14px 重置和查找替换',async()=>{
    const before=await raw()
    await setMarkdownMode(page,'源码')
    assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--editor-size')),'14px')
    const box=await editor().boundingBox();await page.mouse.move(box.x+80,box.y+30)
    await page.keyboard.down('Control');await page.mouse.wheel(0,-120);await page.keyboard.up('Control')
    await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--editor-size')==='15px')
    await editor().focus();await editor().press('Control+0')
    await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--editor-size')==='14px')
    await editor().press('Control+Home');await editor().press('ArrowRight');await editor().press('ArrowRight');await editor().press('Shift+End')
    await page.locator('[role=menubar]').getByRole('menuitem',{name:'文件',exact:true}).click();await page.locator('.menu-categories').getByRole('menuitem',{name:'格式',exact:true}).click()
    await page.screenshot({path:join(output,'format-menu.png')})
    await page.getByRole('menuitem',{name:'加粗',exact:true}).click()
    assert.ok((await raw()).startsWith('# **中文标题**'))
    await editor().press('Control+z');assert.equal(await raw(),before)
    await editor().press('Control+r');const panel=page.locator('.fleet-search')
    await panel.locator('input[name=search]').fill('bold');await panel.locator('input[name=replace]').fill('native')
    await page.waitForFunction(()=>document.querySelector('.search-count').textContent.includes('1'))
    await page.screenshot({path:join(output,'fleet-search.png')})
    await panel.locator('button[name=replaceAll]').click();assert.ok((await raw()).includes('**native**'))
    await panel.locator('button[name=close]').click();await editor().focus();await editor().press('Control+z');assert.equal(await raw(),before)
  })
  await test('Phase 5: 30 次真实模式切换不修改 BOM/CRLF/末尾状态', async () => {
    for (let i = 0; i < 10; i++) for (const mode of ['源码', '双栏', '即时排版']) {
      await setMarkdownMode(page,mode)
      assert.equal(await raw(), original)
    }
    await editor().press('Control+s')
    await pause(200)
    assert.deepEqual(await readFile(fixture), Buffer.concat([bom, Buffer.from(original)]))
  })
  await test('GFM 表格：原生真实鼠标映射、单元格编辑、BOM/CRLF 保存与撤销', async () => {
    const before = await raw()
    await setMarkdownMode(page,'即时排版')
    await page.evaluate(() => { const m = document.querySelector('#app').__vue_app__._instance.setupState.manager; m.dispatch(m.activeId,{selection:{anchor:0}}) })
    const cell = page.locator('.cm-md-table tr').last().locator('td').first()
    await cell.waitFor()
    const position = Number(await cell.getAttribute('data-source-from'))
    await cell.click()
    assert.equal(await page.evaluate(() => document.querySelector('#app').__vue_app__._instance.setupState.manager.view.state.selection.main.head), position)
    await page.keyboard.insertText('原生表格')
    const edited = await raw();assert.ok(edited.includes('原生表格1'))
    await editor().press('Control+s')
    for(let i=0;i<50;i++){if((await readFile(fixture)).equals(Buffer.concat([bom,Buffer.from(edited)])))break;await pause(100)}
    assert.deepEqual(await readFile(fixture),Buffer.concat([bom,Buffer.from(edited)]))
    await editor().press('Control+z');assert.equal(await raw(),before)
    await editor().press('Control+y');assert.equal(await raw(),edited)
    await editor().press('Control+z');await editor().press('Control+s')
    for(let i=0;i<50;i++){if((await readFile(fixture)).equals(Buffer.concat([bom,Buffer.from(before)])))break;await pause(100)}
    assert.deepEqual(await readFile(fixture),Buffer.concat([bom,Buffer.from(before)]))
    await page.evaluate(() => window.nativeNoRefresh = true)
    await editor().press('Control+f');assert.equal(await page.locator('input[name=replace]').isVisible(),false)
    await page.locator('input[name=search]').press('Control+r');assert.equal(await page.locator('input[name=replace]').isVisible(),true)
    assert.equal(await page.evaluate(() => window.nativeNoRefresh),true)
    await page.locator('input[name=replace]').press('Escape')
    await page.screenshot({path:join(output,'native-table.png')})
  })
  await test('Markdown 坐标：40 次真实点击、滚动、编辑撤销和段落留白', () => checkMarkdownClicks(page, output))
  await test('选区回归：原生明暗、拖选/失焦/键盘、Markdown 三模式可见且撤销保留',async()=>{
    const before=await raw()
    await setMarkdownMode(page,'源码')
    await editor().focus();await editor().press('Control+a')
    await page.keyboard.insertText('0123456789 中文拖选 abcdefghijklmnopqrstuvwxyz\n第二行 **bold** keyboard selection abcdefghijklmnopqrstuvwxyz\n第三行')
    for(const theme of ['dark','light']) {
      await page.getByTitle('设置',{exact:true}).click()
      await page.getByLabel('颜色主题',{exact:true}).selectOption(theme)
      await page.getByRole('button',{name:'完成',exact:true}).click()
      for(const mode of ['源码','即时排版','双栏']) {
        await setMarkdownMode(page,mode)
        await checkSelection(page,{output,name:`selection-${theme}-${mode}`})
      }
    }
    await setMarkdownMode(page,'源码')
    await editor().focus();await editor().press('Control+z')
    assert.equal(await raw(),before)
    assert.deepEqual(await readFile(fixture),Buffer.concat([bom,Buffer.from(before)]))
  })
  await test('Phase 6: 双窗格真实键盘编辑、共享撤销与磁盘保存',async()=>{
    const before=await raw()
    await splitPaneViaMenu(page)
    await page.waitForSelector('.secondary-pane .cm-editor')
    const left=page.locator('.main-pane .cm-content'),right=page.locator('.secondary-pane .cm-content')
    await left.click();await left.press('Control+Home');await page.keyboard.insertText('LEFT')
    await right.click();await right.press('Control+End');await page.keyboard.insertText('RIGHT')
    assert.equal(await raw(),'LEFT'+before+'RIGHT')
    await right.press('Control+z');assert.equal(await raw(),'LEFT'+before)
    await right.press('Control+z');assert.equal(await raw(),before)
    await right.press('Control+y');await right.press('Control+y');assert.equal(await raw(),'LEFT'+before+'RIGHT')
    await right.press('Control+s');await pause(300)
    assert.deepEqual(await readFile(fixture),Buffer.concat([bom,Buffer.from('LEFT'+before+'RIGHT')]))
    await mergePanesViaMenu(page)
    assert.equal(await page.locator('.cm-editor').count(),1)
  })
  await test('Phase 6: 设置与自定义快捷键实际交互、冲突拒绝与模态保护',async()=>{
    await page.getByTitle('设置',{exact:true}).click()
    await page.getByLabel('颜色主题',{exact:true}).selectOption('light')
    await page.getByLabel('编辑器字号',{exact:true}).fill('17')
    await page.getByLabel('编辑器字体',{exact:true}).selectOption('consolas')
    await page.getByLabel('缩进宽度',{exact:true}).selectOption('4')
    await page.getByLabel('自动软换行',{exact:true}).check()
    await page.getByLabel('显示文档大纲',{exact:true}).check()
    await page.getByLabel('Markdown 默认模式',{exact:true}).selectOption('source')
    await page.getByText('快捷键配置',{exact:true}).click()
    await page.getByLabel('快捷键 转到行',{exact:true}).fill('Mod+S')
    await page.getByRole('button',{name:'应用快捷键',exact:true}).click()
    assert.ok((await page.getByRole('alert').innerText()).includes('重复'))
    await page.getByLabel('快捷键 转到行',{exact:true}).fill('Mod+Alt+J')
    await page.getByRole('button',{name:'应用快捷键',exact:true}).click()
    await page.getByRole('button',{name:'完成',exact:true}).click()
    await editor().click();await editor().press('Control+g')
    assert.equal(await page.getByRole('dialog',{name:'转到指定行'}).count(),0)
    await editor().press('Control+Alt+j')
    const input=page.getByLabel('行号与列号',{exact:true})
    await input.fill('2junk');await input.press('Enter');assert.equal(await input.count(),1)
    const tabs=await page.getByRole('tab').count();await input.press('Control+n');assert.equal(await page.getByRole('tab').count(),tabs)
    await input.fill('2:1');await input.press('Enter')
    assert.ok((await page.locator('.status').innerText()).includes('Ln 2, Col 1'))
    await editor().press('Control+n');await page.keyboard.insertText('a');await editor().press('Control+Home');await editor().press('Tab')
    assert.equal(await raw(),'    a')
    await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;m.close(m.activeId,true)})
    await page.getByRole('tab',{name:/complex.md/}).click()
    await setMarkdownMode(page,'源码')
    await pause(500)
    const settings=JSON.parse(await readFile(join(profile,'editor-settings.json'),'utf8'))
    assert.equal(settings.fontSize,17);assert.equal(settings.indentSize,4);assert.equal(settings.shortcuts['goto-line'],'Mod+Alt+J')
    assert.equal(Object.values(settings.fileModes)[0],'source')
  })
  await test('三态主题：真实窗口标题栏、界面及 system 首选项保存',async()=>{
    const before=await raw()
    for(const theme of ['dark','light','system']) {
      await page.getByTitle('设置',{exact:true}).click()
      await page.getByLabel('颜色主题',{exact:true}).selectOption(theme)
      await page.getByRole('button',{name:'完成',exact:true}).click()
      await page.waitForFunction(async theme=>{
        const expected=theme==='system' ? (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light') : theme
        return document.documentElement.style.colorScheme===expected &&
          await window.__TAURI_INTERNALS__.invoke('plugin:window|theme',{label:'main'})===expected
      },theme)
      assert.equal(await raw(),before)
    }
    await pause(500)
    assert.equal(JSON.parse(await readFile(join(profile,'editor-settings.json'),'utf8')).theme,'system')
    assert.equal(await page.getByAltText('Markumo 标志').evaluate(img=>img.complete&&img.naturalWidth===512),true)
  })
  await test('Phase 6: 真实桌面退出再启动后首选项与文件模式恢复',async()=>{
    await page.screenshot({path:join(output,'phase6.png')})
    // Exercise the production close handshake, including its settings flush.
    await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'})).catch(error=>{
      if(!String(error).includes('closed')) throw error
    })
    for(let i=0;i<100&&exitCode===undefined;i++)await pause(100)
    assert.notEqual(exitCode,undefined,'first CLI must release app and server')
    await browser.close();browser=undefined;page=undefined
    launch();await connect()
    await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--editor-size')==='17px')
    assert.equal(await page.evaluate(()=>document.body.classList.contains('light')===!matchMedia('(prefers-color-scheme: dark)').matches),true)
    assert.equal(await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.activeDocument.mode),'source')
    assert.ok((await page.locator('.status').innerText()).includes('Spaces: 4'))
    assert.equal(await page.locator('.outline-sidebar').count(),1)
    await editor().press('Control+Alt+j');await page.getByRole('dialog',{name:'转到指定行'}).waitFor();await page.keyboard.press('Escape')
    await page.getByTitle('设置',{exact:true}).click()
    assert.equal(await page.getByLabel('颜色主题',{exact:true}).inputValue(),'system')
    assert.equal(await page.getByLabel('编辑器字体',{exact:true}).inputValue(),'consolas')
    assert.equal(await page.getByLabel('自动软换行',{exact:true}).isChecked(),true)
    assert.equal(await page.getByLabel('自动保存',{exact:true}).isChecked(),false)
    assert.equal(await page.getByLabel('Markdown 默认模式',{exact:true}).inputValue(),'source')
    await page.getByRole('button',{name:'完成',exact:true}).click()
  })
  await test('Phase 5: 十次真实编辑/撤销/重做后磁盘只含预期修改', async () => {
    const baseline = await raw()
    await setMarkdownMode(page,'源码')
    await editor().click()
    let expected = baseline
    for (let i = 0; i < 10; i++) {
      const insert = `step${i}`
      await editor().press(i % 2 ? 'Control+End' : 'Control+Home')
      await page.keyboard.insertText(insert)
      expected = i % 2 ? expected + insert : insert + expected
    }
    assert.equal(await raw(), expected)
    for (let i = 0; i < 10; i++) await editor().press('Control+z')
    assert.equal(await raw(), baseline)
    for (let i = 0; i < 10; i++) await editor().press('Control+y')
    assert.equal(await raw(), expected)
    await editor().press('Control+s')
    for (let i = 0; i < 50; i++) { if ((await readFile(fixture)).equals(Buffer.concat([bom, Buffer.from(expected)]))) break; await pause(100) }
    assert.deepEqual(await readFile(fixture), Buffer.concat([bom, Buffer.from(expected)]))
  })
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(output, 'phase5.png') })
  await test('自定义标题栏：真实最小化按钮',async()=>{
    await page.getByRole('button',{name:'最小化窗口',exact:true}).click()
    await page.waitForFunction(async()=>await window.__TAURI_INTERNALS__.invoke('plugin:window|is_minimized',{label:'main'}))
  })
} catch (error) {
  failure = error; console.error(String(error))
  if (page) {
    try {
      await page.screenshot({path:join(output,'failure.png')})
      const diagnostic=await page.evaluate(()=>({text:document.body.innerText.slice(0,1800),tabs:[...document.querySelectorAll('[role=tab]')].map(el=>({text:el.textContent,rect:el.getBoundingClientRect().toJSON()})),active:document.querySelector('#app').__vue_app__?._instance?.setupState.manager?.activeDocument}))
      await writeFile(join(output,'failure-state.json'),JSON.stringify(diagnostic,null,2));console.error(JSON.stringify(diagnostic))
    } catch {}
  }
}
finally {
  try { if (page && browser?.isConnected()) await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|destroy', { label: 'main' })) } catch {}
  for (let i = 0; i < 30 && exitCode === undefined; i++) await pause(100)
  if (exitCode === undefined) child.kill()
  if (!failure && process.env.LIGHTEDIT_TEST_FIXTURE_DIR) {
    await unlink(fixture)
    await rmdir(fixtureDirectory) // Only our newly created, now empty directory.
  }
  await writeFile(join(output, 'native.log'), logs)
  await writeFile(join(output, 'results.json'), JSON.stringify({ realRustIPC: true, fixture, results, errors, failure: failure ? String(failure) : null }, null, 2))
}
if (failure) process.exitCode = 1
