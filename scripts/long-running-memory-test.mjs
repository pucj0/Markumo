// 4.5 Long-Running Stress and Memory Stability Regression Test
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const outDir = path.resolve('test-results/performance-baseline')
fs.mkdirSync(outDir, { recursive: true })

const server = await createServer({
  server: { host: '127.0.0.1', port: 1496, strictPort: true, hmr: false, watch: null },
  plugins: [{
    name: 'media-stream-mock',
    configureServer(s) {
      s.middlewares.use('/test-media/', (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost')
          const name = decodeURIComponent(url.pathname.slice(1))
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
  suite: 'Long-Running Stress and Memory Stability Test',
  startedAt: new Date().toISOString(),
  mediaCycles: [],
  markdownCycles: [],
  passed: false,
}

let browser
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.MARKUMO_CHROME || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    args: ['--js-flags=--expose-gc', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
  })

  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('HeapProfiler.enable')

  // Phase A: 30 cycles of PDF & Image Open/Close with strict Worker/Blob tracking
  console.log('[STRESS] Running 30 Media (PDF/Image) Open/Close cycles...')
  await page.goto('http://127.0.0.1:1496/scripts/media-harness.html')
  await page.waitForFunction(() => !!window.mediaTest)

  for (let i = 1; i <= 30; i++) {
    // Open single.pdf
    await page.evaluate(() => window.mediaTest.open('single.pdf'))
    await page.waitForFunction(() => !!document.querySelector('.pdf-page'))
    await page.evaluate(() => window.mediaTest.close())
    await page.waitForFunction(() => window.mediaTest.workers.size === 0)

    // Open image
    await page.evaluate(() => window.mediaTest.open('transparent.png'))
    await page.waitForFunction(() => document.querySelector('.image-stage img')?.naturalWidth > 0)
    await page.evaluate(() => window.mediaTest.close())
    await page.waitForFunction(() => window.mediaTest.blobs.size === 0)

    if (i % 10 === 0 || i === 1) {
      await cdp.send('HeapProfiler.collectGarbage')
      const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
      const dom = await cdp.send('Memory.getDOMCounters')
      report.mediaCycles.push({
        cycle: i,
        heapMiB: Number((metrics.JSHeapUsedSize / 1048576).toFixed(3)),
        domNodes: dom.nodes,
        listeners: dom.jsEventListeners,
      })
      console.log(`[MEDIA CYCLE ${i}/30] Heap: ${report.mediaCycles.at(-1).heapMiB} MiB, DOM: ${dom.nodes}`)
    }
  }

  // Phase B: 50 cycles of Markdown Live/Source/Split + CodeBlock + MultiPane
  console.log('[STRESS] Running 50 Markdown lifecycle and editing stress cycles...')
  await page.goto('http://127.0.0.1:1496/test-results/phase07/browser-harness.html')
  await page.waitForFunction(() => !!window.f?.ready())

  for (let i = 1; i <= 50; i++) {
    // 1. Create document with multiple code blocks and paragraphs
    await page.evaluate(num => {
      const source = `# Stress Document ${num}\n\n` +
        'Paragraph content text testing Typora-like live performance.\n\n' +
        '```js\nconst val = ' + num + ';\nfunction test() { return val * 2; }\n```\n\n' +
        '```mermaid\ngraph TD\n  A-->B\n```\n\n' +
        '$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$\n\n'
      window.f.reset(source, false)
    }, i)
    await page.waitForFunction(() => !!window.f.ready())

    // 2. Continuous typing, undo and redo
    await page.evaluate(() => {
      window.f.insert('追加文本内容 ')
      window.f.undo()
      window.f.redo()
    })

    // 3. Switch modes: live -> source -> split -> live
    await page.evaluate(() => {
      const m = window.f.manager, id = window.f.id
      m.setMarkdownMode(id, 'source')
      m.setMarkdownMode(id, 'split')
      m.setMarkdownMode(id, 'live')
    })
    await page.waitForFunction(() => !!window.f.ready())

    // 4. Split pane and close split
    await page.evaluate(() => {
      const pane = window.f.split()
      window.f.manager.closeSplit()
    })

    // 5. Dispose document
    await page.evaluate(() => {
      window.f.dispose()
    })

    if (i % 10 === 0 || i === 1) {
      await cdp.send('HeapProfiler.collectGarbage')
      const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
      const dom = await cdp.send('Memory.getDOMCounters')
      report.markdownCycles.push({
        cycle: i,
        heapMiB: Number((metrics.JSHeapUsedSize / 1048576).toFixed(3)),
        domNodes: dom.nodes,
        listeners: dom.jsEventListeners,
      })
      console.log(`[MARKDOWN CYCLE ${i}/50] Heap: ${report.markdownCycles.at(-1).heapMiB} MiB, DOM: ${dom.nodes}`)
    }
  }

  // Verify memory stability after initial lazy style/asset warmup (cycle 10 -> cycle 50)
  const warmNodes = report.markdownCycles.find(c => c.cycle === 10).domNodes
  const finalNodes = report.markdownCycles.at(-1).domNodes
  assert(Math.abs(finalNodes - warmNodes) <= 15, `DOM nodes leak detected in settled window: ${warmNodes} -> ${finalNodes}`)

  report.completedAt = new Date().toISOString()
  report.passed = true
  fs.writeFileSync(path.join(outDir, 'long-running-stress-results.json'), JSON.stringify(report, null, 2))
  console.log('[PASS] Long running memory stability verified. Results written.')

} finally {
  await browser?.close()
  await server.close()
}
