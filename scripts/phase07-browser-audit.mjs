// Production-built test hosts using the real editor/viewer/controller modules.
// Native IPC is explicitly a fixture transport; these results do not measure Tauri startup.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { build, preview } from 'vite'
import { chromium } from 'playwright'

const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
const label = arg('label', 'baseline')
assert.match(label, /^[a-zA-Z0-9_-]+$/)
const minutes = Number(arg('soak-minutes', '30'))
assert(Number.isFinite(minutes) && minutes >= 0 && minutes <= 60)
const port = Number(arg('port', '1477'))
assert(Number.isInteger(port) && port >= 1024 && port <= 65535)
const buildId = arg('build-id', `browser-dist-${label}`)
assert.match(buildId, /^[a-zA-Z0-9_-]+$/)
const buildDirectory = `test-results/phase07/${buildId}`
const out = path.resolve('test-results/phase07', label)
fs.mkdirSync(out, { recursive: true })
const host = 'test-results/phase07/browser-harness.html'
fs.writeFileSync(host, `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app" style="display:flex;height:720px"></div><script type="module">
import '/scripts/fixtures/markdown-live-controller.js'
import { DocumentManager } from '/src/editor/core/DocumentManager.ts'
import { FileController } from '/src/features/files/FileController.ts'
import { WorkspaceController } from '/src/features/workspace/WorkspaceController.ts'
import { NativeListenerScope } from '/src/app/desktopStartup.ts'
window.audit = { DocumentManager, FileController, WorkspaceController, NativeListenerScope, longTasks: [] }
new PerformanceObserver(list => window.audit.longTasks.push(...list.getEntries().map(e => ({startTime:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true})
window.f.reset(${JSON.stringify('# Ready\n\nAudit fixture.\n')})
</script>`)

if (!process.argv.includes('--reuse-build')) {
  await build({ logLevel: 'warn', build: { outDir: buildDirectory, emptyOutDir: true,
    rollupOptions: { input: { editor: path.resolve(host), media: path.resolve('scripts/media-harness.html') } } } })
}
const fixtureNames = new Set(['single.pdf', 'transparent.png', 'sample.jpg'])
const server = await preview({ logLevel: 'warn', build: { outDir: buildDirectory },
  preview: { host: '127.0.0.1', port, strictPort: true }, plugins: [{ name: 'phase07-fixture-transport', configurePreviewServer(server) {
    server.middlewares.use('/test-media/', (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost'), name = decodeURIComponent(url.pathname.slice(1))
        assert(fixtureNames.has(name), 'Unrecognized fixture')
        const file = path.resolve('.markumo-media-test/fixtures', name), stat = fs.statSync(file)
        const ext = name.split('.').pop(), mime = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg' }[ext]
        if (url.searchParams.has('meta')) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify([{ byteLength: stat.size, mime, format: ext.toUpperCase() }, 'fixture'])); return
        }
        const offset = Number(url.searchParams.get('offset')), length = Number(url.searchParams.get('length'))
        assert(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length > 0 && length <= 256 * 1024 && offset + length <= stat.size)
        const fd = fs.openSync(file, 'r'), bytes = Buffer.alloc(length)
        try { fs.readSync(fd, bytes, 0, length, offset) } finally { fs.closeSync(fd) }
        res.end(bytes)
      } catch (error) { res.statusCode = 400; res.end(String(error)) }
    })
  } }] })
const base = `http://127.0.0.1:${port}`
const report = { label, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  mode: 'production-built component hosts / Chromium / fixture media IPC; NOT native desktop',
  startedAt: new Date().toISOString(), startup: [], editing: [], lifecycle: [], soak: [], errors: [] }
const persist = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2))
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return { n: sorted.length, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1),
    ...(sorted.length >= 20 ? { p95: sorted[Math.ceil(sorted.length * .95) - 1] } : {}) }
}
let browser
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.MARKUMO_CHROME,
    args: ['--js-flags=--expose-gc', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
  report.browser = browser.version()
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
  page.setDefaultTimeout(30000)
  page.on('pageerror', error => { report.errors.push(String(error)); persist() })
  // Returning the view itself creates a retained remote JSHandle in Playwright.
  // Readiness predicates must return booleans so they cannot pin disposed trees.
  const ready = () => page.waitForFunction(() => !!(window.f?.ready() && window.f.live()?.view))
  // Fresh browser contexts are isolated frontend loads, not OS cold boot or native app launches.
  for (let i = 0; i < 5; i++) {
    const context = await browser.newContext(), fresh = await context.newPage(), start = performance.now()
    await fresh.goto(`${base}/${host}`)
    await fresh.waitForFunction(() => !!(window.f?.ready() && window.f.live()?.view))
    report.startup.push({ scenario: 'fresh-context-editor-ready', run: i + 1, ms: performance.now() - start })
    await context.close()
  }
  const settledDom = (samples, name) => {
    const warm = samples.filter(row => row.cycle >= 10 && row.cycle <= 25).map(row => row.dom.nodes)
    const tail = samples.filter(row => row.cycle >= 35).map(row => row.dom.nodes)
    // Compare windows of GC samples, allowing transient asynchronous teardown.
    // A growing retained tree cannot be hidden by checking attached views alone.
    assert(Math.min(...tail) <= Math.max(...warm), `${name}: late GC DOM floor exceeds the complete warmed sample window`)
  }
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    await page.goto(`${base}/${host}`); await ready()
    report.startup.push({ scenario: 'same-context-editor-ready', run: i + 1, ms: performance.now() - start })
  }
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const sample = async (scenario, cycle) => {
    await cdp.send('HeapProfiler.collectGarbage')
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
    return { scenario, cycle, elapsedMs: performance.now(), heap: metrics.JSHeapUsedSize,
      dom: await cdp.send('Memory.getDOMCounters'), editor: await page.evaluate(() => window.f.snapshot()) }
  }
  const heapSnapshot = async name => {
    const file = path.join(out, `${name}.heapsnapshot`), fd = fs.openSync(file, 'w')
    const write = ({ chunk }) => fs.writeSync(fd, chunk)
    cdp.on('HeapProfiler.addHeapSnapshotChunk', write)
    try { await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false }) }
    finally { cdp.off('HeapProfiler.addHeapSnapshotChunk', write); fs.closeSync(fd) }
  }
  const datasets = {
    text1000: { kind: 'text', text: Array.from({ length: 1000 }, (_, i) => `Line ${i} ordinary text`).join('\n') },
    text10000: { kind: 'text', text: Array.from({ length: 10000 }, (_, i) => `Line ${i} ordinary text`).join('\n') },
    text50000: { kind: 'text', text: Array.from({ length: 50000 }, (_, i) => `Line ${i} ordinary text`).join('\n') },
    longLine: { kind: 'text', text: 'long-line '.repeat(50000) },
    markdown1000: { kind: 'live', text: Array.from({ length: 500 }, (_, i) => `Paragraph ${i} target words.\n`).join('\n') },
    markdown10000: { kind: 'live', text: Array.from({ length: 5000 }, (_, i) => `Paragraph ${i} target.\n`).join('\n') },
    markdown50000: { kind: 'live', text: Array.from({ length: 25000 }, (_, i) => `Paragraph ${i} target.\n`).join('\n') },
    code: { kind: 'live', text: Array.from({ length: 40 }, (_, i) => `\`\`\`js\nconst n${i} = ${i}\n\`\`\`\n`).join('\n') },
    tables: { kind: 'live', text: '| A | B |\n|---|---|\n| one | two |\n\n'.repeat(30) },
    images: { kind: 'live', text: '![pixel](./assets/pixel.png)\n\n'.repeat(40) },
    dualPane: { kind: 'live', text: '# Dual\n\nParagraph target.\n' },
  }
  for (const [name, data] of Object.entries(datasets)) {
    const start = performance.now()
    await page.evaluate(({ kind, text }) => {
      const f = window.f
      f.reset(kind === 'text' ? '' : text)
      if (kind === 'text') {
        f.manager.setMarkdownMode(f.id, 'source', 'main')
        f.manager.setLanguage(f.id, 'Plain Text')
        f.manager.dispatch(f.id, { changes: { from: 0, insert: text }, annotations: f.CMTransaction.addToHistory.of(false) })
      }
    }, data)
    if (data.kind === 'live') await ready()
    else await page.locator('[data-pane="main"] > .cm-editor').waitFor()
    if (name === 'dualPane') { await page.evaluate(() => window.f.split()); await ready() }
    const initMs = performance.now() - start
    const timings = await page.evaluate(async ({ kind }) => {
      const f = window.f, input = [], cursor = [], deletion = [], undo = [], redo = [], scroll = []
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
      const view = kind === 'live' ? f.live('main').view : f.CMView.findFromDOM(document.querySelector('[data-pane="main"] > .cm-editor'))
      for (let i = 0; i < 25; i++) {
        let start = performance.now()
        if (kind === 'live') view.dispatch(view.state.tr.insertText('x', 1).setMeta('isolated', true))
        else view.dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' })
        await frame(); input.push(performance.now() - start)
        start = performance.now(); f.undo(); await frame(); undo.push(performance.now() - start)
        start = performance.now(); f.redo(); await frame(); redo.push(performance.now() - start)
        start = performance.now()
        if (kind === 'live') view.dispatch(view.state.tr.delete(1, 2).setMeta('isolated', true))
        else view.dispatch({ changes: { from: 0, to: 1 }, userEvent: 'delete.backward' })
        await frame(); deletion.push(performance.now() - start)
        start = performance.now()
        if (kind === 'live') view.dispatch(view.state.tr.setSelection(f.TextSelection.create(view.state.doc, 1)))
        else view.dispatch({ selection: { anchor: Math.min(i, view.state.doc.length) } })
        await frame(); cursor.push(performance.now() - start)
        start = performance.now()
        const scrollHost = kind === 'live' ? f.live('main').dom : view.scrollDOM
        scrollHost.scrollTop = i * 100
        await frame(); scroll.push(performance.now() - start)
      }
      return { input, cursor, deletion, undo, redo, scroll, longTasks: window.audit.longTasks.splice(0) }
    }, data)
    report.editing.push({ name, chars: data.text.length, lines: data.text.split('\n').length,
      sha256: createHash('sha256').update(data.text).digest('hex'), initMs, raw: timings,
      stats: Object.fromEntries(Object.entries(timings).filter(([key]) => key !== 'longTasks').map(([key, values]) => [key, stats(values)])) })
    persist(); console.log(`MEASURE ${name} init=${Math.round(initMs)}ms inputMedian=${stats(timings.input).median.toFixed(1)}ms`)
  }
  const cycleText = '# Lifecycle\n\nParagraph target.\n\n```js\nconst cycle = 1\n```\n\n| A | B |\n|---|---|\n| one | two |\n'
  await page.evaluate(text => window.f.reset(text), cycleText); await ready()
  await page.evaluate(() => window.f.dispose())
  report.lifecycle.push(await sample('editor-split-code-table-dispose', 0))
  for (let cycle = 1; cycle <= 50; cycle++) {
    await page.evaluate(text => window.f.reset(text), cycleText); await ready()
    await page.evaluate(() => window.f.split()); await ready()
    await page.locator('[data-pane="main"] .md-prose td').first().click()
    const toolbar = page.locator('.md-table-tools.is-active').first()
    await toolbar.getByRole('button', { name: '表格行列操作', exact: true }).click()
    await page.keyboard.press('Escape')
    const result = await page.evaluate(() => window.f.dispose())
    assert(result.pmDestroyed && result.cmDestroyed && result.rootsRemoved && result.remaining === 0)
    if (cycle % 5 === 0) report.lifecycle.push(await sample('editor-split-code-table-dispose', cycle))
  }
  settledDom(report.lifecycle, 'editor lifecycle')
  const contracts = await page.evaluate(async () => {
    const { DocumentManager, FileController, WorkspaceController, NativeListenerScope } = window.audit
    let listeners = 0, stops = 0, count = 0
    for (let i = 0; i < 50; i++) {
      const scope = new NativeListenerScope()
      await scope.register('native', async () => { listeners++; return () => { listeners--; stops++ } })
      await scope.register('native', async () => { throw Error('duplicate registration') })
      scope.dispose(); scope.dispose()
      const manager = new DocumentManager([], async () => [])
      const files = new FileController(manager, { release: async () => {} }, message => { throw Error(message) })
      const gateway = { onSearchBatch: () => { listeners++; return () => listeners-- }, onSearchDone: () => { listeners++; return () => listeners-- },
        getRecentWorkspaces: async () => [], cancelSearch: async () => {},
        openWorkspacePath: async path => ({ rootPath: path, name: path, entries: [] }) }
      const workspace = new WorkspaceController(gateway, manager, files, message => { throw Error(message) })
      if (!await workspace.openWorkspacePath('/fixture/one') || !await workspace.openWorkspacePath('/fixture/two')) throw Error('switch failed')
      workspace.destroy(); files.dispose(); manager.dispose(); count++
    }
    return { cycles: count, listeners, stops }
  })
  assert.deepEqual(contracts, { cycles: 50, listeners: 0, stops: 50 })
  report.controllerContracts = { ...contracts, transport: 'fake native-event and workspace gateways; real ownership/lifecycle classes' }
  persist(); console.log('PASS 50 editor/split/code/table and 50 workspace/listener cycles')
  const media = await browser.newPage({ viewport: { width: 1200, height: 820 } })
  media.on('pageerror', error => report.errors.push(String(error)))
  await media.goto(`${base}/scripts/media-harness.html`)
  await media.waitForFunction(() => !!window.mediaTest)
  const mediaCdp = await media.context().newCDPSession(media)
  await mediaCdp.send('Performance.enable')
  report.media = []
  for (let cycle = 0; cycle <= 50; cycle++) {
    if (cycle) {
      await media.evaluate(() => window.mediaTest.open('single.pdf'))
      await media.waitForFunction(() => !!document.querySelector('.pdf-page .textLayer span'))
      await media.evaluate(() => window.mediaTest.close())
      await media.waitForFunction(() => window.mediaTest.workers.size === 0 && document.querySelectorAll('canvas').length === 0)
      await media.evaluate(n => window.mediaTest.open(n % 2 ? 'sample.jpg' : 'transparent.png'), cycle)
      await media.waitForFunction(() => document.querySelector('.image-stage img')?.naturalWidth > 0)
      await media.evaluate(() => window.mediaTest.close())
      await media.waitForFunction(() => window.mediaTest.blobs.size === 0)
    }
    if (cycle % 5 === 0) {
      await mediaCdp.send('HeapProfiler.collectGarbage')
      report.media.push({ cycle, heap: (await mediaCdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'JSHeapUsedSize').value,
        dom: await mediaCdp.send('Memory.getDOMCounters'), resources: await media.evaluate(() => ({ blobs: window.mediaTest.blobs.size, workers: window.mediaTest.workers.size, released: window.mediaTest.released.length })) })
    }
  }
  settledDom(report.media, 'media lifecycle')
  await media.close(); persist(); console.log('PASS 50 PDF/image cycles; zero outstanding workers and Blob URLs')
  report.tabs = []
  for (const count of [1, 10, 30]) {
    await page.evaluate(() => window.f.reset('# Tab\n\nParagraph.\n')); await ready()
    await page.evaluate(count => {
      const m = window.f.manager
      for (let i = 1; i < count; i++) {
        const id = m.createUntitled('md')
        m.pin(id)
        m.dispatch(id, { changes: { from: 0, insert: `# Tab ${i}\n\n${'Paragraph.\n\n'.repeat(100)}` } })
      }
    }, count)
    await page.waitForFunction(() => window.f.manager.liveViews.get('main')?.id === window.f.manager.activeId)
    report.tabs.push({ ...await sample('open-markdown-tabs', count), tabs: await page.evaluate(() => window.f.manager.openedDocuments.length) })
  }
  // Fixed-length typing/deletion over real PM/CM bridge, preserving source and canonical undo.
  await page.evaluate(text => window.f.reset(text), cycleText); await ready()
  await page.evaluate(() => window.f.caret('Paragraph target.'))
  await heapSnapshot('soak-before')
  const start = performance.now(), deadline = start + minutes * 60000
  let nextSample = start, edits = 0
  while (performance.now() <= deadline) {
    await page.keyboard.type('x'); await page.keyboard.press('Backspace'); edits++
    if (performance.now() >= nextSample) {
      // Publication tracing belongs to the fixture, not the application. Do not
      // retain every pre-edit document in the measurement host itself.
      await page.evaluate(() => { window.f.publications.length = 0 })
      const result = await sample('continuous-live-editing', edits)
      result.elapsedMs = performance.now() - start
      report.soak.push(result); persist(); nextSample += 60000
      console.log(`SOAK minute=${(result.elapsedMs / 60000).toFixed(1)} edits=${edits} heapMiB=${(result.heap / 1048576).toFixed(2)}`)
    }
    // Sampling cadence only, not a readiness wait or regression assertion workaround.
    await new Promise(resolve => setTimeout(resolve, Math.min(1000, Math.max(0, deadline - performance.now()))))
  }
  report.soak.push({ ...await sample('continuous-live-editing-final', edits), elapsedMs: performance.now() - start })
  await heapSnapshot('soak-after')
  assert.equal(await page.evaluate(() => window.f.source()), cycleText)
  report.durationMinutes = (performance.now() - start) / 60000
  report.edits = edits
  report.longTasks = await page.evaluate(() => window.audit.longTasks)
  report.startupStats = Object.fromEntries([...new Set(report.startup.map(x => x.scenario))].map(name => [name, stats(report.startup.filter(x => x.scenario === name).map(x => x.ms))]))
  assert.deepEqual(report.errors, [])
  report.completedAt = new Date().toISOString(); report.passed = true; persist()
  console.log(`PASS browser audit ${label}; ${edits} typing/deletion pairs over ${report.durationMinutes.toFixed(2)} minutes`)
} catch (error) {
  report.failure = String(error.stack || error); persist(); throw error
} finally {
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
