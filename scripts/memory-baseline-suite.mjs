// Chromium component-host memory probe. This never measures native WebView2.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const outDir = path.resolve('test-results/performance-baseline')
fs.mkdirSync(outDir, { recursive: true })
const harness = path.join(outDir, 'component-harness.html')
fs.writeFileSync(harness, `<!doctype html><meta charset="utf-8"><div id="app" style="display:flex;height:720px"></div><script type="module">
import '/scripts/fixtures/markdown-live-controller.js'
import {DocumentManager} from '/src/editor/core/DocumentManager.ts'
window.audit={DocumentManager};window.f.reset('# Ready\\n\\nComponent fixture.\\n')
</script>`)

const sha256 = text => createHash('sha256').update(text).digest('hex')

// Helper: Content Generators with reproducible hash
function generateTxt(lines) {
  const content = Array.from({ length: lines }, (_, i) => `Line ${i + 1}: JetBrains Fleet style fast editing buffer content test.`).join('\n')
  return { content, hash: sha256(content), lines }
}

function generateMarkdownDoc(type) {
  let content = ''
  if (type === 'simple') {
    content = '# Simple Document\n\n' + 'This is a brief markdown paragraph.\n\n'.repeat(10)
  } else if (type === 'medium') {
    content = Array.from({ length: 50 }, (_, i) => `## Section ${i + 1}\n\nParagraph text with **bold**, *italic*, and \`inline code\`.\n\n- Item 1\n- Item 2\n\n`).join('\n')
  } else if (type === 'large') {
    content = Array.from({ length: 300 }, (_, i) => `## Heading ${i + 1}\n\n` + 'Detailed documentation paragraph demonstrating Typora-like live layout.\n\n'.repeat(5)).join('\n')
  }
  return { content, hash: sha256(content), type }
}

function generateCodeBlocks(count) {
  const block = '```javascript\nfunction compute(x, y) {\n  const result = x * y + 42;\n  return result;\n}\n```\n\n'
  const content = `# Document with ${count} Code Blocks\n\n` + block.repeat(count)
  return { content, hash: sha256(content), count }
}

function generateMathDoc(count = 50) {
  const mathBlock = '$$\n\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}\n$$\n\nInline math: $f(x) = \\sum_{n=0}^{\\infty} \\frac{f^{(n)}(a)}{n!}(x-a)^n$.\n\n'
  const content = `# Math Document (${count} equations)\n\n` + mathBlock.repeat(count)
  return { content, hash: sha256(content), count }
}

function generateMermaidDoc(count = 15) {
  const mermaidBlock = '```mermaid\ngraph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[OK]\n  B -->|No| D[Retry]\n```\n\n'
  const content = `# Mermaid Diagrams (${count} charts)\n\n` + mermaidBlock.repeat(count)
  return { content, hash: sha256(content), count }
}

function generateImageDoc(count = 30) {
  const imgBlock = '![Pixel](./assets/pixel.png)\n\n'
  const content = `# Document with ${count} Images\n\n` + imgBlock.repeat(count)
  return { content, hash: sha256(content), count }
}

const fixtureNames = new Set(['single.pdf', 'large.pdf', 'transparent.png', 'sample.jpg'])

// Vite Server for component harness
const server = await createServer({
  server: { host: '127.0.0.1', port: 1495, strictPort: true, hmr: false, watch: null },
  plugins: [{
    name: 'media-stream-mock',
    configureServer(s) {
      s.middlewares.use('/test-media/', (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost')
          const name = decodeURIComponent(url.pathname.slice(1))
          assert(fixtureNames.has(name), `Unknown fixture: ${name}`)
          const file = path.resolve('.markumo-media-test/fixtures', name)
          const stat = fs.statSync(file)
          const ext = name.split('.').pop()
          const mime = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg' }[ext]
          if (url.searchParams.has('meta')) {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify([{ byteLength: stat.size, mime, format: ext.toUpperCase() }, 'v1']))
            return
          }
          const offset = Number(url.searchParams.get('offset'))
          const length = Number(url.searchParams.get('length'))
          const fd = fs.openSync(file, 'r')
          const buf = Buffer.alloc(length)
          try { fs.readSync(fd, buf, 0, length, offset) } finally { fs.closeSync(fd) }
          res.end(buf)
        } catch (e) {
          res.statusCode = 400
          res.end(String(e))
        }
      })
    }
  }]
})
await server.listen()

const report = {
  suite: 'Chromium component host / Vite development modules',
  startedAt: new Date().toISOString(),
  platform: process.platform,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  benchmarks: {},
  lifecycle50: {},
  nativeSummary: { status: 'not-measured', command: 'node scripts/memory-native-ab.mjs --label=before|after', reason: 'Native Release data must be freshly sampled and binary/commit identified; historical Phase 07 JSON is not imported.' },
  leaksIdentified: [],
  hotspots: []
}

let browser
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.MARKUMO_CHROME,
    args: ['--js-flags=--expose-gc', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
  })

  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
  report.browser = browser.version()
  await page.goto('http://127.0.0.1:1495/test-results/performance-baseline/component-harness.html')
  await page.waitForFunction(() => !!window.f?.ready())

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('HeapProfiler.enable')

  async function collectMetrics(scenarioName, metadata = {}) {
    // Collect garbage twice for strict settled baseline
    await cdp.send('HeapProfiler.collectGarbage')
    await cdp.send('HeapProfiler.collectGarbage')

    const metricsArr = (await cdp.send('Performance.getMetrics')).metrics
    const metricsMap = Object.fromEntries(metricsArr.map(m => [m.name, m.value]))
    const domCounters = await cdp.send('Memory.getDOMCounters')

    const state = await page.evaluate(() => {
      const snap = window.f ? window.f.snapshot() : {}
      const canvasElements = document.querySelectorAll('canvas')
      let canvasPixels = 0
      for (const c of canvasElements) {
        canvasPixels += c.width * c.height
      }
      return {
        cmViews: snap.cm ?? 0,
        pmViews: snap.pm ?? 0,
        listeners: snap.listeners ?? 0,
        domCount: snap.dom ?? 0,
        canvasCount: canvasElements.length,
        canvasPixels,
      }
    })

    const record = {
      scenario: scenarioName,
      timestamp: Date.now(),
      jsHeapUsedBytes: metricsMap.JSHeapUsedSize,
      jsHeapTotalBytes: metricsMap.JSHeapTotalSize,
      jsHeapUsedMiB: Number((metricsMap.JSHeapUsedSize / (1024 * 1024)).toFixed(3)),
      domNodes: domCounters.nodes,
      domDocuments: domCounters.documents,
      jsEventListeners: domCounters.jsEventListeners,
      ...state,
      ...metadata,
    }
    report.benchmarks[scenarioName] = record
    console.log(`[BENCH] ${scenarioName.padEnd(30)} -> Heap: ${record.jsHeapUsedMiB} MiB, DOM: ${record.domNodes}, CM: ${record.cmViews}, PM: ${record.pmViews}`)
    return record
  }

  // 1. Empty / Baseline
  await page.evaluate(() => window.f.dispose())
  assert.equal(await page.locator('.cm-editor,.markdown-live').count(), 0)
  await collectMetrics('Empty-component-host', { description: 'Disposed component host with no editor; not blank native app startup' })

  // 2. TXT Scenarios (100, 1000, 10000, 50000 lines) in native Plain Text / CodeMirror
  for (const lines of [100, 1000, 10000, 50000]) {
    const data = generateTxt(lines)
    await page.evaluate(({ src }) => {
      window.f.manager?.dispose()
      document.querySelector('#app').replaceChildren()
      const m = new window.audit.DocumentManager([], async () => [])
      const id = m.createUntitled('txt')
      m.dispatch(id, { changes: { from: 0, insert: src } })
      const host = document.createElement('section')
      host.style.cssText = 'height:720px;flex:1;min-width:0;overflow:hidden;position:relative'
      document.querySelector('#app').append(host)
      m.mountPane(host, 'main')
      window.txtTest = { manager: m, id }
    }, { src: data.content })
    await page.waitForFunction(() => !!document.querySelector('.cm-content'), null, { timeout: 60000 })
    await collectMetrics(`TXT-${lines}-lines`, { lines, hash: data.hash })
  }

  // Restore live harness for markdown scenarios
  await page.evaluate(() => {
    window.txtTest?.manager?.dispose()
    window.f.reset('# Ready\n\nLive ready.\n', false)
  })
  await page.waitForFunction(() => !!window.f.ready(), null, { timeout: 60000 })

  // 3. Markdown Live Scenarios (simple, medium, large)
  for (const type of ['simple', 'medium', 'large']) {
    const data = generateMarkdownDoc(type)
    await page.evaluate(src => window.f.reset(src, false), data.content)
    await page.waitForFunction(() => !!window.f.ready())
    await collectMetrics(`Markdown-Live-${type}`, { type, hash: data.hash })
  }

  // 4. Code Blocks in Live Markdown (10, 50, 100, 200)
  for (const count of [10, 50, 100, 200]) {
    const data = generateCodeBlocks(count)
    await page.evaluate(src => window.f.reset(src, false), data.content)
    await page.waitForFunction(() => !!window.f.ready())
    await collectMetrics(`Markdown-CodeBlocks-${count}`, { count, hash: data.hash })
  }

  // 5. Math Formulas
  {
    const data = generateMathDoc(50)
    await page.evaluate(src => window.f.reset(src, false), data.content)
    await page.waitForFunction(() => !!window.f.ready())
    await collectMetrics('Markdown-Math-50-equations', { count: data.count, hash: data.hash })
  }

  // 6. Mermaid Diagrams
  {
    const data = generateMermaidDoc(15)
    await page.evaluate(src => window.f.reset(src, false), data.content)
    await page.waitForFunction(() => !!window.f.ready())
    await collectMetrics('Markdown-Mermaid-15-charts', { count: data.count, hash: data.hash })
  }

  // 7. Images in Live Markdown
  {
    const data = generateImageDoc(30)
    await page.evaluate(src => window.f.reset(src, false), data.content)
    await page.waitForFunction(() => !!window.f.ready())
    await collectMetrics('Markdown-Images-30-refs', { count: data.count, hash: data.hash })
  }

  // 8. Markdown Split (Source + Preview)
  {
    const data = generateMarkdownDoc('medium')
    await page.evaluate(src => {
      window.f.reset(src, false)
      window.f.manager.setMarkdownMode(window.f.id, 'split')
    }, data.content)
    await page.waitForFunction(() => !!window.f.ready())
    await collectMetrics('Markdown-Split-medium', { hash: data.hash })
  }

  // 9. Multi-Pane (Same file in 2 panes)
  {
    await page.evaluate(() => window.f.reset('# Multi Pane\n\nParagraph text.\n', false))
    await page.evaluate(() => window.f.split())
    await page.waitForFunction(() => !!window.f.ready())
    await collectMetrics('MultiPane-2-panes')
  }

  // 10. Multi-Tabs (10, 50, 100 tabs)
  for (const tabs of [10, 50, 100]) {
    await page.evaluate(num => {
      window.f.reset('# Root Tab\n\nContent.\n', false)
      for (let i = 1; i < num; i++) {
        const id = window.f.manager.createUntitled('txt')
        window.f.manager.open(id, false)
      }
    }, tabs)
    await page.waitForFunction(num => window.f.manager.openedDocuments.length === num, tabs, { timeout: 30000 })
    await collectMetrics(`MultiTabs-${tabs}-documents`, { tabCount: tabs })
  }

  // 11. Media Host: PDF and Image Viewers
  await page.goto('http://127.0.0.1:1495/scripts/media-harness.html')
  await page.waitForFunction(() => !!window.mediaTest)

  for (const pdfName of ['single.pdf', 'large.pdf']) {
    await page.evaluate(name => window.mediaTest.open(name), pdfName)
    await page.waitForFunction(() => !!document.querySelector('.pdf-page'))
    await collectMetrics(`PDF-${pdfName}`, { file: pdfName })
    await page.evaluate(() => window.mediaTest.close())
    await page.waitForFunction(() => window.mediaTest.workers.size === 0)
  }

  for (const imgName of ['transparent.png', 'sample.jpg']) {
    await page.evaluate(name => window.mediaTest.open(name), imgName)
    await page.waitForFunction(() => document.querySelector('.image-stage img')?.naturalWidth > 0)
    await collectMetrics(`Image-${imgName}`, { file: imgName })
    await page.evaluate(() => window.mediaTest.close())
  }

  // 12. 50-Cycle Document Lifecycle (Leak Detection)
  console.log('[LEAK] Starting 50 Document Lifecycle Cycles...')
  await page.goto('http://127.0.0.1:1495/test-results/performance-baseline/component-harness.html')
  await page.waitForFunction(() => !!window.f?.ready())

  const cycleSamples = []
  for (let cycle = 1; cycle <= 50; cycle++) {
    // Action 1: Open and Edit Markdown
    await page.evaluate(i => {
      window.f.reset(`# Lifecycle Cycle ${i}\n\nParagraph text ${i}\n\n\`\`\`js\nconst c = ${i};\n\`\`\`\n`, false)
    }, cycle)
    await page.waitForFunction(() => !!window.f.ready())

    // Action 2: Switch modes (Live -> Source -> Split -> Live)
    await page.evaluate(() => {
      const m = window.f.manager, id = window.f.id
      m.setMarkdownMode(id, 'source')
      m.setMarkdownMode(id, 'split')
      m.setMarkdownMode(id, 'live')
    })
    await page.waitForFunction(() => !!window.f.ready())

    // Action 3: Split Pane then Close Pane
    await page.evaluate(() => {
      const pane = window.f.split()
      window.f.manager.closeSplit()
    })

    // Action 4: Close document
    await page.evaluate(() => {
      window.f.dispose()
    })

    if (cycle === 1 || cycle === 5 || cycle === 10 || cycle === 25 || cycle === 50) {
      await cdp.send('HeapProfiler.collectGarbage')
      const mArr = (await cdp.send('Performance.getMetrics')).metrics
      const mMap = Object.fromEntries(mArr.map(m => [m.name, m.value]))
      const dom = await cdp.send('Memory.getDOMCounters')
      cycleSamples.push({
        cycle,
        heapMiB: Number((mMap.JSHeapUsedSize / (1024 * 1024)).toFixed(3)),
        domNodes: dom.nodes,
        listeners: dom.jsEventListeners
      })
      console.log(`[CYCLE ${cycle}/50] Heap: ${cycleSamples.at(-1).heapMiB} MiB, DOM Nodes: ${dom.nodes}, Listeners: ${dom.jsEventListeners}`)
    }
  }

  report.lifecycle50 = {
    samples: cycleSamples,
    heapGrowthMiB: Number((cycleSamples.at(-1).heapMiB - cycleSamples[0].heapMiB).toFixed(3)),
    domNodeGrowth: cycleSamples.at(-1).domNodes - cycleSamples[0].domNodes,
    stable: (cycleSamples.at(-1).domNodes - cycleSamples[1].domNodes) <= 15
  }

  // 13. Export Heap Snapshot for leak analysis
  console.log('[SNAPSHOT] Capturing baseline Heap Snapshot...')
  const snapshotChunks = []
  cdp.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => snapshotChunks.push(chunk))
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  const snapshotPath = path.join(outDir, 'baseline.heapsnapshot')
  fs.writeFileSync(snapshotPath, snapshotChunks.join(''), 'utf8')
  console.log(`[SNAPSHOT] Saved heap snapshot: ${snapshotPath} (${(fs.statSync(snapshotPath).size / (1024 * 1024)).toFixed(2)} MB)`)

  console.log('[NATIVE] Not measured by this Chromium component suite. Run memory-native-ab.mjs separately.')

  // Save final json report
  fs.writeFileSync(path.join(outDir, 'memory-baseline.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log(`[DONE] Baseline generated: ${path.join(outDir, 'memory-baseline.json')}`)

} finally {
  await browser?.close()
  await server.close()
}
