import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const { chromium } = await import(process.env.MARKUMO_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MARKUMO_PLAYWRIGHT_MODULE).href : 'playwright')
const output = 'test-results/quick-open'
fs.mkdirSync(output, { recursive: true })

const pageShell = (body = '<div id="app"></div>') => `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,">${body}`

fs.writeFileSync(`${output}/unit.html`, pageShell('<div id="app"></div><script type="module" src="./unit.js"></script>'))
fs.writeFileSync(`${output}/unit.js`, `
import { parseQuickOpenQuery, rankPaletteItems, highlightSegments } from '/src/features/shell/quickOpen.ts'
import { WorkspaceController } from '/src/features/workspace/WorkspaceController.ts'
const file=(id,name,path,source='workspace',priority=0)=>({id,name,title:name,fileName:name,detail:path,path,relativePath:path,category:'file',source,priority,action(){},execute(){}})
const command=(id,title,detail='')=>({id,title,detail,category:'action',action(){}})
const items=[
  file('open-main','main.rs','src/main.rs','open',24),
  file('recent-readme','README.md','notes/README.md','recent',14),
  file('workspace-readme','README.md','docs/README.md'),
  file('app-src','App.vue','src/App.vue'),
  file('app-ui','App.vue','packages/ui/App.vue'),
  file('app-root','AppRoot.vue','src/AppRoot.vue'),
  file('editor','editor.ts','src/features/editor.ts'),
  file('theme','theme.css','styles/theme.css'),
  file('windows-app','App.vue','C:\\\\repo\\\\App.vue'),
  command('theme-command','切换主题：深色 / 浅色 / 跟随系统','外观'),
  command('format-command','格式化文档','Shift+Alt+F'),
  command('git-commit','Git: 提交','源代码管理'),
]
const rank=(query,base='file',exact=false)=>rankPaletteItems(items,parseQuickOpenQuery(query,base,exact),100)
const big=Array.from({length:10000},(_,i)=>({
  id:'bulk-'+i,title:'file'+i+'.ts',fileName:'file'+i+'.ts',detail:'src/folder'+(i%100)+'/file'+i+'.ts',
  path:'src/folder'+(i%100)+'/file'+i+'.ts',relativePath:'src/folder'+(i%100)+'/file'+i+'.ts',
  category:'file',source:'workspace',priority:i%5,action(){},execute(){},
}))
const measure=(query,rounds=10)=>{
  const start=performance.now()
  for(let i=0;i<rounds;i++) rankPaletteItems(big,parseQuickOpenQuery(query,'file'),100)
  return (performance.now()-start)/rounds
}
const race=async()=>{
  const resolvers=[], calls=[]
  const gateway={findFiles:(query,includeIgnored,limit)=>new Promise(resolve=>{calls.push({query,includeIgnored,limit});resolvers.push(resolve)})}
  const ws=new WorkspaceController(gateway,{}, {}, ()=>{}, false)
  ws.rootPath='A'; ws.openRevision=1
  const first=ws.ensureFileIndex()
  ws.rootPath='B'; ws.openRevision=2; ws.invalidateFileIndex()
  const second=ws.ensureFileIndex()
  resolvers[0]([file('a','A.ts','A/A.ts')])
  await first
  const afterA=ws.workspaceFiles.map(item=>item.name)
  resolvers[1]([file('b','B.ts','B/B.ts')])
  await second
  const afterB=ws.workspaceFiles.map(item=>item.name)
  return {calls,afterA,afterB,loading:ws.fileIndexLoading}
}
window.q={parseQuickOpenQuery,rankPaletteItems,highlightSegments,items,rank,big,measure,race}
`)
fs.writeFileSync(`${output}/palette.html`, pageShell('<div id="app"></div><button id="outside">outside</button><script type="module" src="./palette.js"></script>'))
fs.writeFileSync(`${output}/palette.js`, `
import { createApp, defineComponent, h, ref, nextTick } from 'vue'
import CommandPalette from '/src/components/modals/CommandPalette.vue'
import '/src/styles/reset.css'; import '/src/styles/variables.css'; import '/src/styles/main.css'
const records=[]
const record=(id,options)=>{records.push({id,options}); if(id==='focus')document.getElementById('outside')?.focus()}
const file=(id,name,path,source='workspace',priority=0,disabled=false)=>({
  id,title:name,fileName:name,detail:path,category:'file',source,path,relativePath:path,priority,disabled,
  action:()=>record(id,{pinned:false}),execute:options=>record(id,options),
})
const command=(id,title,detail='')=>({id,title,detail,category:'action',action:()=>record(id,{pinned:false})})
const items=[
  file('open-main','main.rs','src/main.rs','open',24),
  file('recent-readme','README.md','notes/README.md','recent',14),
  file('workspace-readme','README.md','docs/README.md'),
  file('app-src','App.vue','src/App.vue'),
  file('app-ui','App.vue','packages/ui/App.vue'),
  file('app-root','AppRoot.vue','src/AppRoot.vue'),
  file('editor','editor.ts','src/features/editor.ts'),
  file('colon-file','notes:2024.md','C:\\\\repo\\\\notes:2024.md'),
  file('windows-app','App.vue','C:\\\\repo\\\\App.vue'),
  file('disabled','disabled.ts','src/disabled.ts','workspace',0,true),
  command('theme-command','切换主题：深色 / 浅色 / 跟随系统','外观'),
  command('format-command','格式化文档','Shift+Alt+F'),
  command('git-commit','Git: 提交','源代码管理'),
  ...Array.from({length:40},(_,i)=>file('bulk-'+i,'bulk-'+String(i).padStart(2,'0')+'.md','bulk/bulk-'+String(i).padStart(2,'0')+'.md')),
]
window.records=records
const Harness=defineComponent({
  setup(){
    const palette=ref(null), loading=ref(false)
    window.palette=palette
    window.setLoading=value=>{loading.value=value}
    return ()=>h(CommandPalette,{ref:palette,items,loading:loading.value})
  },
})
window.openP=(mode='file')=>window.palette.value.open(mode)
window.closeP=()=>window.palette.value.close()
createApp(Harness).mount('#app')
`)
fs.writeFileSync(`${output}/app.html`, pageShell('<div id="app"></div><button id="outside">outside</button><script type="module" src="./app.js"></script>'))
fs.writeFileSync(`${output}/app.js`, `
import { createApp, nextTick } from 'vue'
import App from '/src/App.vue'
import '/src/styles/reset.css'; import '/src/styles/variables.css'; import '/src/styles/main.css'; import '/src/editor/markdown/styles.css'; import '/src/editor/core/searchPanel.css'
const app=createApp(App); app.mount('#app'); window.s=app._instance.setupState; window.nextTick=nextTick
`)

const port = Number(process.env.MARKUMO_TEST_PORT || 1462)
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null } })
await server.listen()
const browser = await chromium.launch({ executablePath: process.env.MARKUMO_CHROME, headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
const errors = [], results = []
page.on('pageerror', error => errors.push(error.message))
const base = `http://127.0.0.1:${port}`
const test = async (name, fn) => {
  try { await fn(); results.push({ name, pass: true }); console.log('PASS ' + name) }
  catch (error) { results.push({ name, pass: false, error: String(error) }); await page.screenshot({ path: `${output}/failure.png` }); throw error }
}
const rows = () => page.locator('.palrow')
const input = () => page.locator('.palette-search input')
const selectedLabel = () => page.locator('.palrow.on .label').innerText()
const recordCount = () => page.evaluate(() => window.records.length)
const openPalette = async (mode = 'file') => {
  await page.evaluate(value => window.openP(value), mode)
  await input().waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.activeElement === document.querySelector('.palette-search input'))
}
const closePalette = async () => {
  await page.evaluate(() => window.closeP())
  await page.locator('.palette').waitFor({ state: 'detached' }).catch(() => {})
}

await page.goto(`${base}/${output}/unit.html`)
await page.waitForFunction(() => window.q)

await test('exact, prefix, contiguous, path, acronym and fuzzy matches rank in that order', async () => {
  const result = await page.evaluate(() => {
    const exact = window.q.rank('App.vue')
    const prefix = window.q.rank('App')
    const contiguous = window.q.rank('p.v')
    const path = window.q.rank('src/features')
    const acronym = window.q.rank('ar')
    const fuzzy = window.q.rank('apv')
    return {
      exact: exact[0].item.title,
      prefix: prefix[0].item.title,
      contiguous: contiguous[0].item.title,
      path: path[0].item.title,
      acronym: acronym[0].item.title,
      fuzzy: fuzzy.map(item => item.item.title),
      exactScore: exact[0].score,
      pathScore: path[0].score,
    }
  })
  assert.equal(result.exact, 'App.vue')
  assert.equal(result.prefix, 'App.vue')
  assert.equal(result.path, 'editor.ts')
  assert.equal(result.acronym, 'AppRoot.vue')
  assert.ok(result.exactScore > result.pathScore)
  assert.ok(result.fuzzy.includes('App.vue') || result.fuzzy.includes('AppRoot.vue'))
})

await test('same-name files stay distinct and recent files receive a bounded weight', async () => {
  const result = await page.evaluate(() => {
    const same = window.q.rank('App.vue').filter(item => item.item.title === 'App.vue')
    const readme = window.q.rank('README.md').map(item => ({ path: item.item.path, source: item.item.source }))
    return { same: same.map(item => item.item.path), readme }
  })
  assert.deepEqual(new Set(result.same), new Set(['src/App.vue', 'packages/ui/App.vue', 'C:\\repo\\App.vue']))
  assert.equal(result.readme[0].path, 'notes/README.md')
  assert.equal(result.readme[0].source, 'recent')
})

await test('quick-open query syntax handles line, column, Windows drives and literal colons', async () => {
  const result = await page.evaluate(() => {
    const parse = window.q.parseQuickOpenQuery
    return {
      file: parse('App.vue', 'file'),
      line: parse('App.vue:120', 'file'),
      lineColumn: parse('App.vue:120:5', 'file'),
      windows: parse('C:\\repo\\App.vue:120', 'file'),
      windowsNoPosition: parse('C:\\repo\\App.vue', 'file'),
      driveOnly: parse('C:\\120', 'file'),
      literal: parse('notes:2024.md', 'file', true),
      command: parse('>git', 'file'),
      all: parse('>git', 'all'),
    }
  })
  assert.equal(result.file.line, null)
  assert.equal(result.line.line, 120)
  assert.equal(result.line.text, 'App.vue')
  assert.equal(result.lineColumn.line, 120)
  assert.equal(result.lineColumn.column, 5)
  assert.equal(result.windows.line, 120)
  assert.equal(result.windows.text, 'C:\\repo\\App.vue')
  assert.equal(result.windowsNoPosition.line, null)
  assert.equal(result.driveOnly.line, null)
  assert.equal(result.literal.line, null)
  assert.equal(result.command.mode, 'commands')
  assert.equal(result.command.text, 'git')
  assert.equal(result.all.mode, 'commands')
})

await test('highlight ranges cover the actual matched characters', async () => {
  const result = await page.evaluate(() => {
    const ranked = window.q.rank('App')
    const first = ranked[0]
    return { title: first.item.title, segments: window.q.highlightSegments(first.item.title, first.titleRanges) }
  })
  assert.equal(result.segments.filter(segment => segment.match).map(segment => segment.text).join(''), 'App')
})

await test('10000-file ranking stays bounded and fast enough for every keystroke', async () => {
  const result = await page.evaluate(() => ({
    exact: window.q.measure('file9999', 10),
    path: window.q.measure('src/folder42', 10),
    fuzzy: window.q.measure('f999', 10),
    first: window.q.rankPaletteItems(window.q.big, window.q.parseQuickOpenQuery('file9999', 'file'), 100)[0].item.title,
  }))
  assert.equal(result.first, 'file9999.ts')
  assert.ok(result.exact < 80, `exact search took ${result.exact}ms`)
  assert.ok(result.path < 120, `path search took ${result.path}ms`)
  assert.ok(result.fuzzy < 120, `fuzzy search took ${result.fuzzy}ms`)
  console.log(`  timings: exact ${result.exact.toFixed(2)}ms, path ${result.path.toFixed(2)}ms, fuzzy ${result.fuzzy.toFixed(2)}ms`)
})

await test('workspace index ignores a stale workspace response after switching', async () => {
  const result = await page.evaluate(() => window.q.race())
  assert.deepEqual(result.afterA, [])
  assert.deepEqual(result.afterB, ['B.ts'])
  assert.equal(result.loading, false)
  assert.equal(result.calls.length, 2)
  assert.equal(result.calls[0].limit, 50000)
  assert.equal(result.calls[1].limit, 50000)
})

await page.goto(`${base}/${output}/palette.html`)
await page.waitForFunction(() => window.palette)

await test('the palette is one component for files, open tabs, recents and commands', async () => {
  await openPalette('file')
  assert.match(await input().getAttribute('placeholder'), /搜索文件/)
  assert.ok(await rows().count() > 10)
  await input().fill('App.vue')
  await page.waitForFunction(() => [...document.querySelectorAll('.palrow .label')].filter(element => element.textContent === 'App.vue').length === 3)
  const paths = await page.evaluate(() => [...document.querySelectorAll('.palrow')]
    .filter(row => row.querySelector('.label')?.textContent === 'App.vue')
    .map(row => row.querySelector('.path')?.textContent || ''))
  assert.deepEqual(new Set(paths), new Set(['src/App.vue', 'packages/ui/App.vue', 'C:\\repo\\App.vue']))
  assert.ok(await page.locator('.palrow mark').count() > 0)
  await closePalette()
})

await test('opened tabs and recents are labeled and survive rapid typing without losing the query', async () => {
  await openPalette('file')
  await input().fill('main.rs')
  await page.waitForFunction(() => document.querySelectorAll('.palrow').length > 0)
  assert.equal(await page.locator('.palrow').first().locator('.source').innerText(), '已打开')
  await input().fill('README')
  await page.waitForFunction(() => document.querySelectorAll('.palrow').length > 0)
  assert.equal(await page.locator('.palrow').first().locator('.source').innerText(), '最近')
  await input().fill('')
  await input().pressSequentially('App.vue', { delay: 4 })
  await page.waitForFunction(() => [...document.querySelectorAll('.palrow .label')].filter(element => element.textContent === 'App.vue').length === 3)
  assert.equal(await input().inputValue(), 'App.vue')
  await closePalette()
})

await test('file mode supports exact, path, acronym and fuzzy queries, and > switches to commands', async () => {
  await openPalette('file')
  await input().fill('src/features')
  assert.equal(await page.locator('.palrow').first().locator('.label').innerText(), 'editor.ts')
  assert.ok(await page.locator('.palrow').first().locator('mark').count() > 0)
  await input().fill('ar')
  assert.equal(await page.locator('.palrow').first().locator('.label').innerText(), 'AppRoot.vue')
  await input().fill('>主题')
  await page.waitForFunction(() => document.querySelector('.mode-tag')?.textContent === '命令')
  assert.ok(await rows().count() >= 1)
  assert.equal(await page.locator('.palrow').first().locator('.label').innerText(), '切换主题：深色 / 浅色 / 跟随系统')
  assert.match(await input().getAttribute('placeholder'), /搜索命令/)
  const before = await recordCount()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('.palette'))
  assert.equal(await recordCount(), before + 1)
  assert.equal((await page.evaluate(() => window.records.at(-1))).id, 'theme-command')
})

await test('file:line:col syntax is shown and passed to the execute hook without splitting a drive', async () => {
  await openPalette('file')
  await input().fill('App.vue:120:5')
  await page.waitForFunction(() => document.querySelector('.position')?.textContent?.includes('120'))
  assert.match(await page.locator('.position').innerText(), /120/)
  assert.match(await page.locator('.position').innerText(), /5/)
  await page.locator('.palrow').first().click()
  let record = await page.evaluate(() => window.records.at(-1))
  assert.equal(record.options.line, 120)
  assert.equal(record.options.column, 5)

  await openPalette('file')
  await input().fill('C:\\repo\\App.vue:7')
  await page.waitForFunction(() => document.querySelector('.position')?.textContent?.includes('7'))
  await page.locator('.palrow').first().click()
  record = await page.evaluate(() => window.records.at(-1))
  assert.equal(record.options.line, 7)
  assert.equal(record.item, undefined)

  await openPalette('file')
  await input().fill('notes:2024.md')
  await page.waitForFunction(() => document.querySelectorAll('.palrow').length === 1)
  assert.equal(await page.locator('.position').count(), 0)
  await page.locator('.palrow').first().click()
  record = await page.evaluate(() => window.records.at(-1))
  assert.equal(record.options.line, undefined)
  assert.equal(record.id, 'colon-file')
})

await test('no-result, loading and disabled states stay compact and explicit', async () => {
  await openPalette('file')
  await input().fill('this-file-does-not-exist')
  await page.waitForFunction(() => document.querySelector('.empty-rows'))
  assert.match(await page.locator('.empty-rows').innerText(), /没有匹配/)
  await page.evaluate(() => window.setLoading(true))
  await page.waitForFunction(() => document.querySelector('.loading'))
  assert.match(await page.locator('.loading').innerText(), /索引中/)
  await page.evaluate(() => window.setLoading(false))
  await input().fill('disabled.ts')
  await page.waitForFunction(() => document.querySelectorAll('.palrow').length === 1)
  assert.equal(await page.locator('.palrow').first().isDisabled(), true)
  await page.keyboard.press('Enter')
  assert.equal(await page.locator('.palette').count(), 1)
  await closePalette()
})

await test('keyboard selection, Enter, Ctrl+Enter and Escape focus restoration work', async () => {
  await openPalette('file')
  await input().fill('App')
  await page.waitForFunction(() => document.querySelectorAll('.palrow').length > 1)
  const first = await page.locator('.palrow.on .path').innerText()
  await page.keyboard.press('ArrowDown')
  const second = await page.locator('.palrow.on .path').innerText()
  assert.notEqual(first, second)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('.palette'))
  assert.equal((await page.evaluate(() => window.records.at(-1))).options.pinned, false)

  await openPalette('file')
  await input().fill('README.md')
  await page.waitForFunction(() => document.querySelectorAll('.palrow').length === 2)
  await page.keyboard.press('Control+Enter')
  await page.waitForFunction(() => !document.querySelector('.palette'))
  assert.equal((await page.evaluate(() => window.records.at(-1))).options.pinned, true)

  await page.evaluate(() => document.getElementById('outside').focus())
  await openPalette('file')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.palette'))
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'outside')
})

await test('mouse movement chooses a row but a stationary list does not steal keyboard selection', async () => {
  await openPalette('file')
  await input().fill('App')
  await page.waitForFunction(() => document.querySelectorAll('.palrow').length > 2)
  await page.keyboard.press('ArrowDown')
  const selected = await selectedLabel()
  const other = page.locator('.palrow').nth(3)
  await other.evaluate(element => element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementX: 0, movementY: 0 })))
  assert.equal(await selectedLabel(), selected)
  const box = await other.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  assert.equal(await selectedLabel(), await other.locator('.label').innerText())
  await input().fill('')
  await page.waitForFunction(() => document.querySelectorAll('.palrow').length > 20)
  for (let index = 0; index < 15; index++) await page.keyboard.press('ArrowDown')
  await page.waitForFunction(() => document.querySelector('.palette-rows')?.scrollTop > 0)
  await closePalette()
})

await test('IME composition never triggers Enter or arrow navigation', async () => {
  await openPalette('file')
  await input().fill('App')
  const before = await recordCount()
  await input().evaluate(element => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true, bubbles: true }))
  })
  assert.equal(await recordCount(), before)
  assert.equal(await page.locator('.palette').count(), 1)
  await input().evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('.palette'))
  assert.equal(await recordCount(), before + 1)
})

await page.goto(`${base}/${output}/app.html?demo=1`)
await page.waitForFunction(() => window.s?.manager)
await page.waitForTimeout(100)

await test('Ctrl+P opens the file Quick Open with a clean input and Ctrl+Shift+P opens commands', async () => {
  await page.keyboard.press('Control+P')
  await input().waitFor({ state: 'visible' })
  assert.match(await input().getAttribute('placeholder'), /搜索文件/)
  assert.equal(await input().inputValue(), '')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.palette'))
  await page.keyboard.press('Control+Shift+P')
  await input().waitFor({ state: 'visible' })
  assert.match(await input().getAttribute('placeholder'), /搜索命令/)
  assert.equal(await page.locator('.mode-tag').innerText(), '命令')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.palette'))
})

await test('opening a file from Quick Open focuses the editor and honors line and column', async () => {
  await page.keyboard.press('Control+P')
  await input().fill('main.rs:7:3')
  await page.waitForFunction(() => document.querySelectorAll('.palrow').length > 0)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.s.manager.activeDocument?.name === 'main.rs')
  const result = await page.evaluate(() => {
    const manager = window.s.manager
    const view = manager.paneView(manager.activePane)
    const from = view.state.selection.main.from
    const line = view.state.doc.lineAt(from)
    return {
      name: manager.activeDocument?.name,
      line: line.number,
      column: from - line.from + 1,
      from,
      length: view.state.doc.length,
      focused: !!document.activeElement?.closest('.cm-editor, .md-prose'),
    }
  })
  assert.equal(result.name, 'main.rs')
  assert.equal(result.line, 7, JSON.stringify(result))
  assert.equal(result.column, 3)
  assert.equal(result.focused, true)
})

await test('workspace files open at a line, focus the editor and honor preview versus pinned tabs', async () => {
  await page.evaluate(() => {
    const workspace = window.s.workspace
    workspace.rootPath = 'E:/quick-open-demo'
    workspace.workspaceFiles = [{ name: 'workspace-only.ts', path: 'E:/quick-open-demo/workspace-only.ts', relativePath: 'workspace-only.ts' }]
    workspace.fileIndexRevision = workspace.openRevision
    workspace.openFile = async (node, preview) => {
      window.s.manager.openFile({
        token: 'quick-open-workspace',
        name: node.name,
        path: node.path,
        text: 'one\ntwo\nthree',
        kind: 'text',
        encoding: 'UTF-8',
      }, preview)
    }
  })
  await page.keyboard.press('Control+P')
  await input().fill('workspace-only.ts:2')
  await page.waitForFunction(() => document.querySelectorAll('.palrow').length > 0)
  assert.match(await page.locator('.palfoot .position').innerText(), /2/)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.s.manager.activeDocument?.name === 'workspace-only.ts')
  await page.waitForFunction(() => {
    const manager = window.s.manager
    const view = manager.paneView(manager.activePane)
    return !!view && view.state.doc.lineAt(view.state.selection.main.from).number === 2
  })
  let result = await page.evaluate(() => {
    const manager = window.s.manager
    const view = manager.paneView(manager.activePane)
    const line = view.state.doc.lineAt(view.state.selection.main.from)
    const tab = manager.group.tabs.find(tab => tab.documentId === manager.activeId)
    return { line: line.number, focused: !!document.activeElement?.closest('.cm-editor'), pinned: tab?.pinned }
  })
  assert.equal(result.line, 2)
  assert.equal(result.focused, true)
  assert.equal(result.pinned, false)

  await page.keyboard.press('Control+P')
  await input().fill('workspace-only.ts')
  await page.waitForFunction(() => document.querySelectorAll('.palrow').length > 0)
  await page.keyboard.press('Control+Enter')
  await page.waitForFunction(() => window.s.manager.activeDocument?.name === 'workspace-only.ts')
  result = await page.evaluate(() => {
    const manager = window.s.manager
    const tab = manager.group.tabs.find(tab => tab.documentId === manager.activeId)
    return { pinned: tab?.pinned }
  })
  assert.equal(result.pinned, true)
})

await test('the > prefix switches an already-open file palette to command search and executes the command', async () => {
  const before = await page.evaluate(() => window.s.manager.openedDocuments.length)
  await page.keyboard.press('Control+P')
  await input().fill('>新建')
  await page.waitForFunction(() => document.querySelector('.mode-tag')?.textContent === '命令')
  await page.waitForFunction(() => document.querySelectorAll('.palrow').length > 0)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('.palette'))
  await page.waitForFunction(count => window.s.manager.openedDocuments.length > count, before)
})

const failed = results.filter(result => !result.pass)
console.log(`PASS ${results.length - failed.length} Quick Open groups`)
if (errors.length) {
  console.error('page errors:', errors)
  process.exitCode = 1
}
if (failed.length) process.exitCode = 1
await browser.close()
await server.close()
