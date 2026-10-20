import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const { chromium } = await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const output = 'test-results/quick-open-app'
fs.mkdirSync(output, { recursive: true })
const fixture = fs.mkdtempSync(path.resolve(output, 'disk-')).replace(/\\/g, '/')
const rootA = `${fixture}/A`, rootB = `${fixture}/B`
for (const root of [rootA, rootB]) fs.mkdirSync(root)
const write = (root, name) => fs.writeFileSync(`${root}/${name}`, 'one\ntwo\nthree')
for (const name of ['recent-preview.ts', 'recent-fixed.ts', 'recent-dirty.ts', 'old.ts', 'rename-before.ts']) write(rootA, name)
write(rootB, 'new-workspace.ts')
fs.mkdirSync(`${rootA}/nested`)
write(`${rootA}/nested`, 'nested-removed.ts'); write(`${rootA}/nested`, 'nested-kept.ts')
const rawNode = (root, name) => ({ id: name, name, path: `${root}/${name}`, relative_path: name,
  is_directory: fs.statSync(`${root}/${name}`).isDirectory(), is_symlink: false, is_readonly: false, size: 13, mtime: 0,
  has_children: fs.statSync(`${root}/${name}`).isDirectory() })
const diskEntries = root => fs.readdirSync(root).map(name => rawNode(root, name))
const diskFiles = root => diskEntries(root).flatMap(node => node.is_directory ? diskFiles(node.path) : [{ name: node.name, path: node.path, relative_path: node.path.slice((node.path.startsWith(rootA + '/') ? rootA : rootB).length + 1) }])

fs.writeFileSync(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app"></div><script type="module" src="./fixture.js"></script>')
// Mount the real desktop App, controllers, command registry and Tauri gateways.
// Only IPC is replaced; file operations below read the on-disk fixture.
fs.writeFileSync(`${output}/fixture.js`, `
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { createApp } from 'vue'
import App from '/src/App.vue'
import { rankPaletteItems, parseQuickOpenQuery } from '/src/features/shell/quickOpen.ts'
import '/src/styles/reset.css'; import '/src/styles/variables.css'; import '/src/styles/main.css'; import '/src/editor/markdown/styles.css'
window.isTauri=true; mockWindows('main')
const calls=[], pending=[], pendingReads=[], notices=[]
const rootA=${JSON.stringify(rootA)}, rootB=${JSON.stringify(rootB)}
let root=rootA, deferred=false, failIndex=false, holdReads=false
const layout={mode:'workspace',sidebarWidth:254,sidebarVisible:true}
const recent=['recent-preview.ts','recent-fixed.ts','recent-dirty.ts'].map(name=>({name,path:rootA+'/'+name}))
const disk=async(command,args)=>{
  try {
  const response=await fetch('/__quick_open_disk?'+new URLSearchParams({command,...args}))
  if(!response.ok){const error=await response.text();calls.push({error});throw Error(error)}
  const result=await response.json();calls.push({disk:command,result});return result
  }catch(error){calls.push({diskError:String(error)});throw error}
}
mockIPC(async(command,args)=>{
  calls.push({command,args})
  if(command==='plugin:event|listen')return args.handler
  if(command==='load_editor_settings')return {externalFileMonitoring:false}
  if(command==='initialize_launch')return {kind:'app',ownsSession:true,files:{files:[],errors:[]},roots:[],activePath:null,layout,warnings:[]}
  if(command==='file_preferences')return {recent,layout}
  if(command==='get_recent_workspaces')return []
  if(command==='drain_pending')return {files:[],errors:[]}
  if(command==='update_runtime')return {version:'1.0.4',platform:'linux',installSupported:false}
  if(command==='confirm_update_startup')return null
  if(command==='recovery_list')return {records:[],warnings:[]}
  if(command==='workspace_file_visible')return true
  if(command==='open_workspace_path') {root=args.path;return {root_path:root,name:root.split('/').pop(),entries:await disk('read',{path:root})}}
  if(command==='read_directory') {
    if(holdReads)return new Promise((resolve,reject)=>pendingReads.push(()=>disk('read',args).then(resolve,reject)))
    return disk('read',args)
  }
  if(command==='find_workspace_files') {
    if(failIndex)throw Error('fixture index failure')
    const snapshot=await disk('find',{path:root})
    if(deferred)return new Promise((resolve,reject)=>pending.push({root,resolve:()=>resolve(snapshot),reject}))
    return snapshot
  }
  if(command==='open_recent'||command==='open_workspace_file')return disk('open',args)
  if(command==='check_external_file')return '1'
  if(['plugin:event|unlisten','plugin:window|set_theme','report_update_window','save_editor_settings','persist_layout','persist_session','release_file','watch_external_files','cancel_workspace_search'].includes(command))return
  throw Error('Unexpected Quick Open test IPC: '+command)
})
window.addEventListener('editor-notice',e=>notices.push(e.detail))
const app=createApp(App);app.mount('#app');window.s=app._instance.setupState
window.f={calls,pending,pendingReads,notices,rootA,rootB,rankPaletteItems,parseQuickOpenQuery,now:performance.now.bind(performance),
  holdReads:value=>{holdReads=value},
  defer:value=>{deferred=value}, fail:value=>{failIndex=value},
  state:()=>{const m=window.s.manager;return {name:m.activeDocument?.name,dirty:m.activeDocument?.dirty,pinned:m.group.tabs.find(t=>t.documentId===m.activeId)?.pinned,text:m.getText(m.activeId)}}}
`)

const readDiskRequest = url => {
    const params = new URL(url).searchParams
    const target = params.get('path')
    assert.ok(target === rootA || target === rootB || target?.startsWith(rootA + '/') || target?.startsWith(rootB + '/'))
    const command = params.get('command')
    let result
    if (command === 'read') result = diskEntries(target)
    else if (command === 'find') result = diskFiles(target)
    else if (command === 'open') result = { token: target, name: path.basename(target), path: target, text: fs.readFileSync(target, 'utf8'), kind: 'text', encoding: 'UTF-8', eol: 'LF', bom: false, readOnly: false, version: '1' }
    else throw Error('Unknown fixture command')
    return result
}
const server = await createServer({
  server: { host: '127.0.0.1', port: 1463, strictPort: true, hmr: false, watch: null },
})
await server.listen()
console.log('Quick Open desktop fixture server ready')
let browser
const results = [], errors = [], performanceResults = []
try {
  browser = await chromium.launch({ executablePath: process.env.MARKUMO_CHROME, headless: true, args: ['--no-sandbox'] })
  console.log('Quick Open desktop browser ready')
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(15_000)
  page.setDefaultNavigationTimeout(60_000)
  await page.route('**/__quick_open_disk?*', async route => {
    try { await route.fulfill({ json: readDiskRequest(route.request().url()) }) }
    catch (error) { await route.fulfill({ status: 500, body: String(error) }) }
  })
  page.on('pageerror', error => errors.push(error.message))
  const test = async (name, run) => { await run(); results.push(name); console.log('PASS ' + name) }
  const input = () => page.locator('.palette-search input')
  const named = name => page.locator('.palrow .label').filter({ hasText: new RegExp('^' + name.replaceAll('.', '\\.') + '$') })
  const open = async query => {
    await page.keyboard.press('Control+P'); await input().waitFor({ state: 'visible' })
    await input().fill(query)
  }
  const close = async () => { await page.keyboard.press('Escape'); await page.locator('.palette').waitFor({ state: 'detached' }) }
  const choose = async (query, pinned = false) => {
    await open(query)
    await page.waitForFunction(() => document.querySelector('.palrow.on:not(:disabled)'))
    await page.keyboard.press(pinned ? 'Control+Enter' : 'Enter')
    await page.locator('.palette').waitFor({ state: 'detached' })
    try { await page.waitForFunction(name => window.s.manager.activeDocument?.name === name && !window.s.fileBusy, query) }
    catch(error) { console.error(JSON.stringify(await page.evaluate(() => ({state:window.f.state(),calls:window.f.calls.slice(-15),body:document.body.innerText})),null,2));throw error }
  }
  await page.goto(`http://127.0.0.1:1463/${output}/index.html`)
  await page.waitForFunction(() => window.s?.settingsReady && !window.s.startupLoading && window.s.recentFiles.length === 3)

  await test('real App recent Enter opens preview; Ctrl+Enter pins; Enter keeps fixed and dirty tabs', async () => {
    await choose('recent-preview.ts')
    assert.equal((await page.evaluate(() => window.f.state())).pinned, false)
    await choose('recent-fixed.ts', true)
    assert.equal((await page.evaluate(() => window.f.state())).pinned, true)
    await choose('recent-fixed.ts')
    assert.equal((await page.evaluate(() => window.f.state())).pinned, true)
    await choose('recent-dirty.ts')
    assert.equal((await page.evaluate(() => window.f.state())).pinned, false)
    await page.evaluate(() => { const m=window.s.manager;m.dispatch(m.activeId,{changes:{from:0,insert:'unsaved '}}) })
    await choose('recent-dirty.ts')
    const state = await page.evaluate(() => window.f.state())
    assert.equal(state.pinned, true); assert.equal(state.dirty, true); assert.ok(state.text.startsWith('unsaved '))
    const calls = await page.evaluate(() => window.f.calls.filter(c => c.command === 'open_recent').map(c => c.args.path.split('/').pop()))
    assert.deepEqual(calls, ['recent-preview.ts', 'recent-fixed.ts', 'recent-dirty.ts'])
    // Finish this test's edit so normal workspace switching remains authorized.
    await page.evaluate(() => { const m=window.s.manager;m.dispatch(m.activeId,{changes:{from:0,to:8,insert:''}}) })
  })

  await test('real App refresh reflects external add/delete/rename and keyboard searches reuse the index', async () => {
    await page.evaluate(() => window.s.workspace.openWorkspacePath(window.f.rootA))
    await open('old.ts'); await page.waitForFunction(() => !window.s.workspace.fileIndexLoading)
    assert.equal(await page.locator('.palrow .label').getByText('old.ts', { exact: true }).count(), 1)
    await close()
    write(rootA, 'added.ts'); fs.unlinkSync(`${rootA}/old.ts`); fs.renameSync(`${rootA}/rename-before.ts`, `${rootA}/rename-after.ts`)
    await page.evaluate(() => window.s.workspace.refreshDirectory())
    await open('old.ts'); assert.equal(await named('old.ts').count(), 0)
    await input().fill('rename-before.ts'); assert.equal(await named('rename-before.ts').count(), 0)
    await input().fill('rename-after.ts'); assert.equal(await named('rename-after.ts').count(), 1)
    await input().fill('added.ts'); assert.equal(await named('added.ts').count(), 1)
    const before = await page.evaluate(() => window.f.calls.filter(c => c.command === 'find_workspace_files').length)
    await input().fill(''); await input().pressSequentially('added.ts', { delay: 3 })
    assert.equal(await page.evaluate(() => window.f.calls.filter(c => c.command === 'find_workspace_files').length), before)
    await page.keyboard.press('Enter'); await page.waitForFunction(() => window.s.manager.activeDocument?.name === 'added.ts')
    assert.equal((await page.evaluate(() => window.f.state())).pinned, false)
    await choose('added.ts', true); await choose('added.ts')
    assert.equal((await page.evaluate(() => window.f.state())).pinned, true)
  })

  await test('real App arrows skip disabled commands, wrap both ways, and all-disabled Enter does nothing', async () => {
    await open('>')
    const enabled = await page.locator('.palrow:not(:disabled)').evaluateAll(rows => rows.map(r => r.querySelector('.label').textContent))
    const disabled = await page.locator('.palrow:disabled').count()
    assert.ok(disabled > 0); assert.ok(enabled.length > 2)
    for (const expected of [...enabled.slice(1), enabled[0]]) {
      await page.keyboard.press('ArrowDown'); assert.equal(await page.locator('.palrow.on .label').innerText(), expected)
    }
    await page.keyboard.press('ArrowUp'); assert.equal(await page.locator('.palrow.on .label').innerText(), enabled.at(-1))
    await input().fill('>查看 JVM ClassFile 结构'); await page.waitForFunction(() => document.querySelectorAll('.palrow').length === 1)
    assert.equal(await page.locator('.palrow').isDisabled(), true)
    const before = await page.evaluate(() => window.f.calls.length)
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter')
    assert.equal(await page.locator('.palette').count(), 1); assert.equal(await page.locator('.palrow.on').count(), 0)
    assert.equal(await page.evaluate(() => window.f.calls.length), before)
    await close()
  })

  await test('root and subdirectory refresh never resurrect deleted files from collapsed tree caches', async () => {
    await page.evaluate(async () => {
      const w=window.s.workspace,node=w.entries.find(n=>n.name==='nested')
      await w.toggleFolder(node); await w.toggleFolder(node)
    })
    fs.unlinkSync(`${rootA}/nested/nested-removed.ts`)
    await page.evaluate(() => window.s.workspace.refreshDirectory())
    // The cached tree children intentionally survive a root-only refresh.
    assert.ok(await page.evaluate(() => window.s.workspace.entries.find(n=>n.name==='nested').children.some(n=>n.name==='nested-removed.ts')))
    await open('nested-removed.ts'); assert.equal(await named('nested-removed.ts').count(), 0); await close()
    fs.unlinkSync(`${rootA}/nested/nested-kept.ts`);write(`${rootA}/nested`, 'nested-added.ts')
    await page.evaluate(() => {const w=window.s.workspace;return w.refreshDirectory(w.entries.find(n=>n.name==='nested'))})
    await open('nested-kept.ts');assert.equal(await named('nested-kept.ts').count(),0)
    await input().fill('nested-added.ts');assert.equal(await named('nested-added.ts').count(),1);await close()
  })

  await test('real App workspace switch fences stale index success and rejection', async () => {
    await page.evaluate(() => { window.f.defer(true);window.s.workspace.invalidateFileIndex() })
    await open('added.ts'); await page.waitForFunction(() => window.f.pending.length === 1)
    await page.evaluate(() => window.s.workspace.openWorkspacePath(window.f.rootB))
    await close(); await open('new-workspace.ts'); await page.waitForFunction(() => window.f.pending.length === 2)
    await page.evaluate(() => window.f.pending[0].resolve())
    assert.deepEqual(await page.evaluate(() => window.s.workspace.workspaceFiles), [])
    assert.equal(await page.evaluate(() => window.s.workspace.fileIndexLoading), true)
    await page.evaluate(() => window.f.pending[1].resolve())
    await page.waitForFunction(() => !window.s.workspace.fileIndexLoading)
    assert.deepEqual(await page.evaluate(() => window.s.workspace.workspaceFiles.map(f => f.name)), ['new-workspace.ts'])
    await input().fill('added.ts'); assert.equal(await named('added.ts').count(), 1) // Open tab remains available.
    assert.equal(await named('added.ts').locator('xpath=ancestor::button').locator('.source').innerText(), '已打开')
    await close()
    await page.evaluate(() => { window.s.workspace.invalidateFileIndex();void window.s.workspace.ensureFileIndex() })
    await page.waitForFunction(() => window.f.pending.length === 3)
    await page.evaluate(() => window.s.workspace.openWorkspacePath(window.f.rootA))
    await open('rename-after.ts'); await page.waitForFunction(() => window.f.pending.length === 4)
    await page.evaluate(() => window.f.pending[2].reject(Error('stale failure')))
    assert.equal(await page.evaluate(() => window.s.workspace.fileIndexLoading), true)
    await page.evaluate(() => { window.f.pending[3].resolve();window.f.defer(false) })
    await page.waitForFunction(() => !window.s.workspace.fileIndexLoading)
    assert.ok((await page.evaluate(() => window.s.workspace.workspaceFiles.map(f => f.name))).includes('rename-after.ts'))
    await close()
  })

  await test('real App failed index retains useful files, removes confirmed deletions, and retries only on refresh', async () => {
    fs.unlinkSync(`${rootA}/rename-after.ts`)
    await page.evaluate(() => { window.f.fail(true) })
    await page.evaluate(() => window.s.workspace.refreshDirectory())
    const before = await page.evaluate(() => window.f.calls.filter(c => c.command === 'find_workspace_files').length)
    for (let i = 0; i < 3; i++) {
      await open('rename-after.ts'); assert.equal(await named('rename-after.ts').count(), 0)
      await input().fill('added.ts'); assert.equal(await named('added.ts').count(), 1)
      await close()
    }
    assert.equal(await page.evaluate(() => window.f.calls.filter(c => c.command === 'find_workspace_files').length), before)
    await page.evaluate(() => { window.f.fail(false) })
    await page.evaluate(() => window.s.workspace.refreshDirectory())
    assert.equal(await page.evaluate(() => window.f.calls.filter(c => c.command === 'find_workspace_files').length), before + 1)
  })

  await test('real App index IPC timeout clears loading and ignores late results without retry loops', async () => {
    await page.clock.install()
    await page.evaluate(() => { window.f.defer(true);window.s.workspace.invalidateFileIndex(false);void window.s.workspace.ensureFileIndex() })
    await page.waitForFunction(() => window.f.pending.length === 5)
    await page.clock.fastForward(12_001)
    await page.waitForFunction(() => !window.s.workspace.fileIndexLoading)
    const before = await page.evaluate(() => window.f.calls.filter(c => c.command === 'find_workspace_files').length)
    await page.evaluate(() => window.s.workspace.ensureFileIndex())
    assert.equal(await page.evaluate(() => window.f.calls.filter(c => c.command === 'find_workspace_files').length), before)
    const files = await page.evaluate(() => window.s.workspace.workspaceFiles.map(f => f.path))
    await page.evaluate(() => { window.f.pending[4].resolve();window.f.defer(false) })
    assert.deepEqual(await page.evaluate(() => window.s.workspace.workspaceFiles.map(f => f.path)), files)
    await page.clock.resume()
  })

  await test('a scan started during directory refresh is invalidated again when the refresh completes', async () => {
    const pending = await page.evaluate(() => {
      window.f.holdReads(true);window.f.defer(true)
      window.refreshPromise=window.s.workspace.refreshDirectory()
      return window.f.pending.length
    })
    await page.waitForFunction(() => window.f.pendingReads.length === 1)
    await open('during-refresh.ts')
    await page.waitForFunction(count => window.f.pending.length === count + 1, pending)
    write(rootA, 'during-refresh.ts')
    await page.evaluate(count => window.f.pending[count].resolve(), pending)
    await page.waitForFunction(() => !window.s.workspace.fileIndexLoading)
    await page.evaluate(() => window.f.pendingReads[0]())
    await page.waitForFunction(count => window.f.pending.length === count + 2, pending)
    await page.evaluate(count => {window.f.pending[count + 1].resolve();window.f.defer(false);window.f.holdReads(false)}, pending)
    await page.evaluate(() => window.refreshPromise)
    assert.equal(await named('during-refresh.ts').count(), 1)
    await close()
  })

  await test('10000/50000 cached files record cold/warm search time and retained heap growth', async () => {
    const cdp = await page.context().newCDPSession(page)
    for (const count of [10_000, 50_000]) {
      await cdp.send('HeapProfiler.collectGarbage')
      const before = (await cdp.send('Runtime.getHeapUsage')).usedSize
      await page.evaluate(count => {
        window.benchmarkFiles=Array.from({length:count},(_,i)=>({id:'perf'+i,title:'file'+i+'.ts',fileName:'file'+i+'.ts',detail:'src/folder'+(i%100)+'/file'+i+'.ts',path:'src/folder'+(i%100)+'/file'+i+'.ts',relativePath:'src/folder'+(i%100)+'/file'+i+'.ts',category:'file',source:'workspace',action(){}}))
      }, count)
      const timings = await page.evaluate(count => {
        const result={}
        for(const [name,query] of [['exact','file'+(count-1)],['path','src/folder42'],['fuzzy','f999']]) {
          const run=()=>window.f.rankPaletteItems(window.benchmarkFiles,window.f.parseQuickOpenQuery(query,'file'),100)
          let start=window.f.now();const ranked=run();const coldMs=window.f.now()-start
          start=window.f.now();for(let i=0;i<10;i++)run()
          result[name]={coldMs,warmMs:(window.f.now()-start)/10,first:ranked[0]?.item.title,results:ranked.length}
        }
        return result
      }, count)
      await cdp.send('HeapProfiler.collectGarbage')
      const heapDeltaBytes = (await cdp.send('Runtime.getHeapUsage')).usedSize - before
      assert.equal(timings.exact.first, `file${count - 1}.ts`)
      for (const value of Object.values(timings)) { assert.ok(value.results <= 100);assert.ok(value.warmMs < (count === 10_000 ? 120 : 600), JSON.stringify(value)) }
      const result = { count, timings, heapDeltaBytes, heapDeltaMiB: heapDeltaBytes / 1024 / 1024 }
      performanceResults.push(result);console.log('  performance: ' + JSON.stringify(result))
      await page.evaluate(() => { delete window.benchmarkFiles })
    }
    await cdp.detach()
  })
  assert.deepEqual(errors, [])
  console.log(`PASS ${results.length} real App Quick Open groups`)
} finally {
  fs.writeFileSync(`${output}/results.json`, JSON.stringify({ results, errors, performance: performanceResults }, null, 2))
  await browser?.close(); await server.close()
}
