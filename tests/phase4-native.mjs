import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Real Windows WebView2, Tauri commands and disposable disk fixtures; no IPC stubs.
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const output = join(root, 'test-results/phase4-native', String(Date.now()))
const fixture = join(output, 'workspace'), other = join(output, 'other-workspace'), profile = join(output, 'profile')
const { chromium } = createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE || import.meta.url)('playwright')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
function appPids() {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Process lightedit,markumo -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id; exit 0'], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean).map(Number)
}
assert.deepEqual(appPids(), [], 'Keep existing user windows intact: close them before isolated desktop regression.')
await Promise.all([mkdir(join(fixture, 'src'), { recursive: true }), mkdir(join(fixture, 'dest'), { recursive: true }), mkdir(other, { recursive: true }), mkdir(join(profile, 'temp'), { recursive: true })])
for (let i = 0; i < 10000; i += 100) {
  await Promise.all(Array.from({ length: 100 }, (_, j) => writeFile(join(fixture, `entry-${String(i + j).padStart(5, '0')}.txt`), 'fixture text')))
}
const source = '中文🚀hit\r\nsecond hit'
const bom = Buffer.from([0xef, 0xbb, 0xbf])
await writeFile(join(fixture, 'src/中文.txt'), Buffer.concat([bom, Buffer.from(source)]))
await writeFile(join(fixture, 'ignored.log'), 'hidden fixture')
await writeFile(join(fixture, '.gitignore'), '*.log\n')
await writeFile(join(other, 'second.txt'), 'hit second folder')
await writeFile(join(fixture,'a-native.bat'),Buffer.concat([bom,Buffer.from('@echo off\r\nrem 中文\r\necho safe')]))
await writeFile(join(fixture,'b-native.cmd'),Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('@echo off\r\nrem 中文\r\necho safe','utf16le')]))
const canonical = path => '\\\\?\\' + path
const selected = canonical(fixture), selectedOther = canonical(other)
// Seed history only for our dedicated fixture: exercises real recent-path authorization.
await writeFile(join(profile, 'workspaces.json'), JSON.stringify({ recent_workspaces: [selected, selectedOther], active_roots: [selected, selectedOther] }))
// Existing dirty/explicit-save cases deliberately run with automatic saves off.
await writeFile(join(profile, 'editor-settings.json'), JSON.stringify({autoSave:false}))
const env = { ...process.env, LIGHTEDIT_DEV_DATA_DIR: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9226', CARGO_NET_OFFLINE: 'true' }
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH'
env[pathKey] = join(process.env.USERPROFILE, '.cargo/bin') + ';' + env[pathKey]
const child = spawn(process.execPath, [join(root, 'scripts/tauri.mjs'), 'dev', '--no-watch'], { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
let logs = '', exitCode, browser, page, failure
child.stdout.on('data', chunk => { logs += chunk }); child.stderr.on('data', chunk => { logs += chunk })
child.on('exit', code => { exitCode = code })
const results = [], errors = [], dialogs = []
async function test(name, callback) { await callback(); results.push({ name, result: 'PASS' }); console.log(`PASS ${name}`) }
const editor = () => page.getByRole('textbox', { name: '文本编辑器', exact: true })
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
const treeRow = name => page.locator('.workspace-tree-container .treenode').filter({ has: page.locator('.label', { hasText: new RegExp(`^${name}$`) }) })
try {
  console.log('10,000-file fixture prepared; waiting for dedicated Tauri instance.')
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    if (exitCode !== undefined) throw new Error(`CLI exited ${exitCode}: ${logs.slice(-2000)}`)
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9226'); break } catch { await pause(500) }
  }
  assert.ok(browser, 'native app started')
  for (let i = 0; i < 60; i++) {
    page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('http://localhost:1420'))
    if (page) break
    await pause(250)
  }
  assert.ok(page)
  page.on('pageerror', e => errors.push(e.message))
  page.on('dialog', async dialog => {
    if (dialog.type() === 'confirm') await dialog.accept()
    else if (dialogs.length) await dialog.accept(dialogs.shift())
    else { errors.push(`unexpected dialog: ${dialog.message()}`); await dialog.dismiss() }
  })
  await editor().waitFor({ timeout: 15000 })
  await test('真实冷启动恢复已保存的多文件夹工作区配置',async()=>{
    await page.waitForFunction(()=>document.querySelector('#app').__vue_app__._instance.setupState.workspace.roots.length===2)
    assert.ok((await invoke('read_directory',{path:selectedOther})).some(node=>node.name==='second.txt'))
  })
  await test('真实最近目录授权、10,000 个平级文件下虚拟树与编辑响应', async () => {
    await editor().press('Control+Alt+b')
    await page.locator('[role=menubar]').getByRole('menuitem',{name:'文件',exact:true}).click()
    await page.locator('[data-menu-popup]').getByRole('menuitem',{name:'工作区',exact:true}).click()
    await page.locator('[data-menu-popup]').getByRole('menuitem',{name:'最近工作区',exact:true}).click()
    await page.locator('[data-menu-popup]').getByRole('menuitem',{name:'workspace',exact:true}).click()
    await treeRow('src').waitFor({ timeout: 15000 })
    const maximumTreeRows = await page.locator('.workspace-tree-container').evaluate(element => { const visible = Math.ceil(element.clientHeight / 26) + 1; return visible + Math.max(4,Math.ceil(visible * .2)) * 2 })
    assert.ok(await page.locator('.workspace-tree-container .treenode').count() <= maximumTreeRows)
    const elapsed = await page.evaluate(async () => {
      const start = performance.now(); await new Promise(resolve => requestAnimationFrame(() => resolve())); return performance.now() - start
    })
    assert.ok(elapsed < 1000, `next frame ${elapsed}ms`)
    results.push({ nextFrameMs: elapsed, treeRows: await page.locator('.workspace-tree-container .treenode').count() })
    await editor().click(); await page.keyboard.insertText('响应测试'); await editor().press('Control+z')
    assert.equal((await editor().innerText()).trim(), '')
  })
  await test('新工具栏排序、新建菜单、全展开/收起与全高度滚动',async()=>{
    const toolbar=page.getByRole('toolbar',{name:'工作区工具栏'})
    assert.deepEqual(await toolbar.getByRole('button').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label'))),['全部展开','全部收起','新建','定位当前文件','刷新目录树'])
    await toolbar.getByRole('button',{name:'新建',exact:true}).click()
    assert.deepEqual(await page.getByRole('menu',{name:'新建',exact:true}).getByRole('menuitem').allTextContents(),['新建文件','新建文件夹']);await page.keyboard.press('Escape')
    await toolbar.getByRole('button',{name:'全部展开',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#app').__vue_app__._instance.setupState.workspace.expanding)
    await page.locator('.workspace-tree-container').evaluate(el=>el.scrollTop=el.scrollHeight)
    assert.equal(await treeRow('ignored.log').count(),0)
    await page.waitForFunction(()=>[...document.querySelectorAll('.workspace-tree-container .label')].some(el=>el.textContent==='entry-09999.txt'))
    await toolbar.getByRole('button',{name:'全部收起',exact:true}).click();assert.equal(await page.locator('.workspace-tree-container .treenode').count(),1)
    await page.locator('.root-toggle').click()
    await page.locator('.workspace-tree-container').evaluate(el=>el.scrollTop=0)
  })
  await test('原生 .bat/.cmd 文本编辑、撤销重做、真实手动/自动保存基线与失败保留',async()=>{
    for(const [name,encoding,bomBytes] of [['a-native.bat','utf8',bom],['b-native.cmd','utf16le',Buffer.from([0xff,0xfe])]]){
      const path=join(fixture,name),source='@echo off\r\nrem 中文\r\necho safe'
      const file=await invoke('open_workspace_file',{path:selected+'\\'+name})
      const id=await page.evaluate(file=>document.querySelector('#app').__vue_app__._instance.setupState.files.accept(file,false),file)
      await page.getByRole('tab',{name,exact:true}).waitFor()
      assert.equal(await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.activeDocument.language),'Plain Text')
      assert.deepEqual(await readFile(path),Buffer.concat([bomBytes,Buffer.from(source,encoding)]))
      await editor().focus();await editor().press('Control+End');await page.keyboard.insertText(' edited')
      await page.locator('.cm-change-modified').waitFor();await editor().press('Control+z');assert.equal(await page.locator('.cm-change-modified').count(),0);await editor().press('Control+y')
      await editor().press('Control+s');await page.waitForFunction(()=>document.querySelector('.dirty-item').textContent==='已保存');assert.equal(await page.locator('.cm-change-modified').count(),0)
      assert.deepEqual(await readFile(path),Buffer.concat([bomBytes,Buffer.from(source+' edited',encoding)]))
      await page.getByTitle('设置',{exact:true}).click();await page.getByLabel('自动保存',{exact:true}).check();await page.getByLabel('自动保存延迟',{exact:true}).selectOption('500');await page.getByRole('button',{name:'完成',exact:true}).click()
      await editor().focus();await editor().press('Control+End');await page.keyboard.insertText('\nauto line')
      await page.locator('.cm-change-inserted').waitFor();await page.waitForFunction(()=>document.querySelector('.dirty-item').textContent==='已保存');assert.equal(await page.locator('.cm-change-inserted').count(),0)
      assert.deepEqual(await readFile(path),Buffer.concat([bomBytes,Buffer.from(source+' edited\r\nauto line',encoding)]))
      await page.getByTitle('设置',{exact:true}).click();await page.getByLabel('自动保存延迟',{exact:true}).selectOption('1500');await page.getByLabel('自动保存',{exact:true}).uncheck();await page.getByRole('button',{name:'完成',exact:true}).click()
      const external=Buffer.concat([bomBytes,Buffer.from('external\r\n原始磁盘保留',encoding)]);await writeFile(path,external)
      await editor().focus();await editor().press('Control+End');await page.keyboard.insertText(' keep');await editor().press('Control+s');await page.waitForFunction(()=>document.querySelector('.toast')?.textContent.includes('内容仍保留'))
      assert.deepEqual(await readFile(path),external);assert.ok(await page.locator('.cm-change-modified').count());assert.equal(await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.manager.activeDocument.dirty),true)
      await page.getByRole('button',{name:`关闭 ${name}`,exact:true}).click();await page.getByRole('button',{name:'放弃修改并关闭',exact:true}).click()
    }
  })
  await test('Ctrl+P 查找未展开子目录、实际打开及底栏路径', async () => {
    await editor().press('Control+p')
    await page.getByRole('textbox', { name: '搜索文件或命令' }).fill('中文')
    await page.locator('.palrow').filter({ hasText: 'src/中文.txt' }).waitFor({ timeout: 15000 })
    await page.locator('.palrow').filter({ hasText: 'src/中文.txt' }).click()
    await page.getByRole('tab', { name: /中文.txt/ }).waitFor()
    assert.equal(await editor().innerText(), source.replace('\r\n', '\n'))
    assert.equal(await page.locator('.status .file-path').innerText(), 'src/中文.txt')
    const shownPath = await page.locator('.status .file-path').getAttribute('title')
    assert.ok(shownPath.endsWith('workspace\\src\\中文.txt'))
    assert.equal(shownPath.startsWith('\\\\?\\'), false)
    const before=await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;return {count:m.openedDocuments.length,text:m.saveSnapshot(m.activeId).text}})
    const toolbar=page.getByRole('toolbar',{name:'工作区工具栏'})
    await toolbar.getByRole('button',{name:'全部收起',exact:true}).click();await toolbar.getByRole('button',{name:'定位当前文件',exact:true}).click()
    await page.locator('.workspace-tree-container .treenode.active').waitFor()
    const after=await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;return {count:m.openedDocuments.length,text:m.saveSnapshot(m.activeId).text}})
    assert.deepEqual(after,before)
    const row=await page.locator('.workspace-tree-container .treenode.active').boundingBox(),tree=await page.locator('.workspace-tree-container').boundingBox()
    assert.ok(row.y>=tree.y&&row.y+row.height<=tree.y+tree.height+1)
  })
  await test('搜索快捷键聚焦、中文/emoji 的 UTF-16 光标定位', async () => {
    await editor().press('Control+Shift+f')
    await page.waitForFunction(() => document.activeElement?.classList.contains('search-input'))
    await page.locator('.search-input').fill('hit'); await page.locator('.search-input').press('Enter')
    await page.locator('.match-row').first().waitFor({ timeout: 15000 })
    await page.locator('.match-row').first().click()
    await page.waitForFunction(() => document.querySelector('.status')?.textContent.includes('Ln 1, Col 5'))
    assert.match(await page.locator('.status').innerText(), /Ln 1, Col 5/)
    const done = await invoke('search_workspace', { query: { search_id: 'native-cap', query: 'fixture', is_case_sensitive: false, is_whole_word: false, is_regex: false, max_results: 3 } })
    assert.equal(done, 3)
  })
  await test('文件重命名后实际 Ctrl+S、BOM/CRLF 与 dirty 数据保留', async () => {
    await page.getByTitle('文件资源管理器', { exact: true }).click()
    if(await treeRow('src').getAttribute('aria-expanded')!=='true')await treeRow('src').click()
    await treeRow('中文.txt').waitFor()
    await editor().click(); await editor().press('Control+End'); await page.keyboard.insertText('修改')
    await treeRow('中文.txt').focus(); await treeRow('中文.txt').getByTitle('重命名', { exact: true }).click()
    await page.getByRole('textbox', { name: '名称或目标目录' }).fill('renamed.txt')
    await page.getByRole('dialog', { name: '工作区文件操作' }).getByRole('button', { name: '重命名', exact: true }).click()
    await page.getByRole('tab', { name: /renamed.txt/ }).waitFor()
    assert.match(await page.locator('.dirty-item').innerText(), /未保存/)
    await editor().click(); await editor().press('Control+s')
    for (let i = 0; i < 50; i++) { if ((await readFile(join(fixture, 'src/renamed.txt'))).equals(Buffer.concat([bom, Buffer.from(source + '修改')]))) break; await pause(100) }
    assert.deepEqual(await readFile(join(fixture, 'src/renamed.txt')), Buffer.concat([bom, Buffer.from(source + '修改')]))
  })
  await test('移动入口、目录子文件 Tab/path/授权同步与再次真实保存', async () => {
    await treeRow('src').focus(); await treeRow('src').getByTitle('移动到…', { exact: true }).click()
    await page.getByRole('textbox', { name: '名称或目标目录' }).fill(selected + '\\dest')
    await page.getByRole('dialog', { name: '工作区文件操作' }).getByRole('button', { name: '移动', exact: true }).click()
    await treeRow('dest').waitFor()
    await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('已移动:'))
    assert.match(await page.locator('.status .file-path').innerText(), /dest.*src/s)
    await editor().click(); await editor().press('Control+End'); await page.keyboard.insertText('再次'); await editor().press('Control+s')
    for (let i = 0; i < 50; i++) { if ((await readFile(join(fixture, 'dest/src/renamed.txt'))).equals(Buffer.concat([bom, Buffer.from(source + '修改再次')]))) break; await pause(100) }
    assert.deepEqual(await readFile(join(fixture, 'dest/src/renamed.txt')), Buffer.concat([bom, Buffer.from(source + '修改再次')]))
  })
  await test('忽略覆盖、CRUD/同名冲突与未授权路径拒绝', async () => {
    const defaults = await invoke('read_directory', { path: selected })
    assert.ok(!defaults.some(n => n.name === 'ignored.log'))
    await page.locator('.workspace-tree-container').evaluate(el=>el.scrollTop=0)
    await page.locator('.root-toggle').first().click({button:'right'})
    await page.locator('[data-menu-popup]').getByRole('menuitemcheckbox',{name:'显示忽略文件',exact:true}).click()
    const shown = await invoke('read_directory', { path: selected })
    assert.ok(shown.some(n => n.name === 'ignored.log'))
    await invoke('create_workspace_file', { parentDir: selected, name: 'disposable.txt' })
    await assert.rejects(invoke('create_workspace_file', { parentDir: selected, name: 'disposable.txt' }))
    await invoke('delete_workspace_node', { path: selected + '\\disposable.txt' })
    await assert.rejects(invoke('create_workspace_file', { parentDir: selected, name: '../escape.txt' }))
    await assert.rejects(invoke('open_workspace_path', { path: root }))
  })
  await test('应用内删除确认：取消不删除、确认才执行', async () => {
    await page.getByRole('toolbar',{name:'工作区工具栏'}).getByRole('button',{name:'新建',exact:true}).click()
    await page.getByRole('menuitem',{name:'新建文件夹',exact:true}).click()
    await page.getByRole('textbox', { name: '名称或目标目录' }).fill('disposable-dir')
    await page.getByRole('dialog', { name: '工作区文件操作' }).getByRole('button', { name: '创建', exact: true }).click()
    await treeRow('disposable-dir').waitFor()
    await treeRow('disposable-dir').focus(); await treeRow('disposable-dir').getByTitle('删除', { exact: true }).click()
    await page.getByRole('dialog', { name: '工作区文件操作' }).getByRole('button', { name: '取消', exact: true }).click()
    assert.ok((await invoke('read_directory', { path: selected })).some(n => n.name === 'disposable-dir'))
    await treeRow('disposable-dir').focus(); await treeRow('disposable-dir').getByTitle('删除', { exact: true }).click()
    await page.getByRole('dialog', { name: '工作区文件操作' }).getByRole('button', { name: '删除', exact: true }).click()
    await treeRow('disposable-dir').waitFor({ state: 'hidden' })
    assert.ok(!(await invoke('read_directory', { path: selected })).some(n => n.name === 'disposable-dir'))
  })
  await test('切换工作区保留另一份 dirty 草稿、取消后 UI 不追加旧结果', async () => {
    await editor().press('Control+n'); await page.keyboard.insertText('未保存草稿')
    await editor().press('Control+Shift+p')
    await page.getByRole('textbox', { name: '搜索文件或命令' }).fill('打开工作区文件夹')
    await page.locator('.palrow').filter({ hasText: '打开工作区文件夹' }).click()
    await page.locator('.overlay').waitFor({ state: 'hidden' })
    assert.equal(await editor().innerText(), '未保存草稿')
    assert.match(await page.locator('.toast').innerText(), /未保存/)
    await editor().press('Control+Shift+f')
    await page.locator('.search-input').fill('fixture')
    // Observe the real DOM button before starting so a fast local search cannot
    // finish while Playwright waits two frames for pointer-action stability.
    const canceled = page.evaluate(() => new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const button = document.querySelector('.cancel-btn')
        if (!button) return
        observer.disconnect(); clearTimeout(timer); button.click(); resolve(true)
      })
      const timer = setTimeout(() => { observer.disconnect(); reject(new Error('cancel button did not appear')) }, 5000)
      observer.observe(document.body, { childList: true, subtree: true })
    }))
    await page.locator('.search-input').press('Enter')
    await canceled
    const count = await page.locator('.match-row').count()
    await pause(1500)
    assert.equal(await page.locator('.match-row').count(), count)
  })
  for(const theme of ['dark','light']) {
    await page.getByTitle('设置',{exact:true}).click();await page.getByLabel('颜色主题',{exact:true}).selectOption(theme)
    await page.getByRole('button',{name:'完成',exact:true}).click();await page.locator('.settingsoverlay').waitFor({state:'hidden'})
    await page.screenshot({path:join(output,`${theme}.png`)})
  }
  await test('窄窗口自动收起后仍可用 Ctrl+Shift+F 显示搜索', async () => {
    await page.setViewportSize({ width: 780, height: 700 })
    await page.locator('.sidebar-wrapper').waitFor({ state: 'hidden' })
    await editor().press('Control+Shift+f')
    await page.locator('.sidebar-wrapper').waitFor({ state: 'visible' })
    await page.waitForFunction(() => document.activeElement?.classList.contains('search-input'))
    assert.equal(await page.locator('.search-input').inputValue(), 'fixture')
    assert.ok((await editor().boundingBox()).width > 300)
    await page.screenshot({ path: join(output, 'narrow.png') })
    assert.equal(await page.locator('.topbar').evaluate(el=>el.scrollWidth>el.clientWidth),false)
    for(const name of ['文件','编辑','格式','视图']) assert.equal(await page.getByRole('menubar').getByRole('menuitem',{name,exact:true}).isVisible(),true)
  })
  await test('添加第二文件夹保留 dirty 文档、双根搜索/快速打开/重命名保存与安全移除',async()=>{
    await page.setViewportSize({width:1200,height:780})
    await page.locator('[role=menubar]').getByRole('menuitem',{name:'文件',exact:true}).click()
    await page.locator('[data-menu-popup]').getByRole('menuitem',{name:'工作区',exact:true}).click()
    assert.equal(await page.locator('[data-menu-popup]').getByRole('menuitem',{name:'添加文件夹…',exact:true}).isDisabled(),false)
    await page.keyboard.press('Escape');await page.keyboard.press('Escape')
    // The native folder picker is a manual acceptance item. Use the real
    // controller/gateway on our authorized fixture, with no IPC stub.
    await page.evaluate(path=>document.querySelector('#app').__vue_app__._instance.setupState.workspace.openWorkspacePath(path,true),selectedOther)
    await page.waitForFunction(()=>document.querySelector('#app').__vue_app__._instance.setupState.workspace.roots.length===2)
    const saved=JSON.parse(await readFile(join(profile,'workspaces.json'),'utf8'));assert.deepEqual(saved.active_roots,[selected,selectedOther])
    await page.locator('.root-toggle').filter({has:page.locator('.label',{hasText:/^workspace$/})}).click()
    assert.deepEqual(await page.locator('.root-toggle .label').allTextContents(),['workspace','other-workspace'])
    await page.screenshot({path:join(output,'both-folders.png')})
    assert.ok(await page.evaluate(()=>{const m=document.querySelector('#app').__vue_app__._instance.setupState.manager;return m.openedDocuments.some(doc=>m.getText(doc.id)==='未保存草稿')}))
    await page.evaluate(()=>document.querySelector('#app').__vue_app__._instance.setupState.workspace.search('hit'))
    await page.waitForFunction(()=>document.querySelector('#app').__vue_app__._instance.setupState.workspace.searchResults.some(group=>group.relativePath.startsWith('other-workspace/')))
    await editor().focus();await editor().press('Control+p')
    await page.getByRole('textbox',{name:'搜索文件或命令'}).fill('second.txt')
    await page.locator('.palrow').filter({hasText:'second.txt'}).click();await page.getByRole('tab',{name:/second.txt/}).waitFor();assert.equal(await editor().innerText(),'hit second folder')
    assert.match(await page.locator('.status .file-path').innerText(),/other-workspace.*second.txt/s)
    await page.evaluate(async()=>{const ws=document.querySelector('#app').__vue_app__._instance.setupState.workspace;await ws.renameNode(ws.roots[1].entries.find(node=>node.name==='second.txt'),'second-renamed.txt')})
    await editor().focus();await editor().press('Control+End');await page.keyboard.insertText(' saved');await editor().press('Control+s')
    await page.waitForFunction(()=>document.querySelector('.dirty-item').textContent==='已保存')
    assert.equal(await readFile(join(other,'second-renamed.txt'),'utf8'),'hit second folder saved')
    await page.locator('.root-toggle').filter({has:page.locator('.label',{hasText:/^other-workspace$/})}).click({button:'right'})
    await page.locator('[data-menu-popup]').getByRole('menuitem',{name:'移除工作区根目录',exact:true}).click()
    await page.waitForFunction(()=>document.querySelector('#app').__vue_app__._instance.setupState.workspace.roots.length===1)
    await assert.rejects(invoke('open_workspace_file',{path:selectedOther+'\\second-renamed.txt'}))
    await editor().focus();await editor().press('Control+End');await page.keyboard.insertText(' after removal');await editor().press('Control+s')
    await page.waitForFunction(()=>document.querySelector('.dirty-item').textContent==='已保存')
    assert.equal(await readFile(join(other,'second-renamed.txt'),'utf8'),'hit second folder saved after removal')
    assert.equal(await page.locator('.sidebar-wrapper').getByText('OPEN EDITORS',{exact:true}).count(),0)
    assert.equal(await page.locator('.sidebar-wrapper').getByText('RECENT FILES',{exact:true}).count(),0)
    await page.screenshot({path:join(output,'multi-folder.png')})
  })
  assert.deepEqual(errors, [])
} catch (error) {
  failure = error; console.error(String(error))
  if (page && !page.isClosed()) {
    try { await page.screenshot({ path: join(output, 'failure.png') }); await writeFile(join(output, 'failure-ui.txt'), await page.locator('body').innerText()) } catch {}
  }
}
finally {
  // Preserve fixtures and logs; close only this isolated app.
  try { if (page && browser?.isConnected()) await invoke('plugin:window|destroy', { label: 'main' }) } catch {}
  for (let i = 0; i < 30 && exitCode === undefined; i++) await pause(100)
  if (exitCode === undefined) child.kill()
  await writeFile(join(output, 'native.log'), logs)
  await writeFile(join(output, 'results.json'), JSON.stringify({ realRustIPC: true, fixture, results, errors, failure: failure ? String(failure) : null }, null, 2))
}
if (failure) process.exitCode = 1
