// Isolated production component memory snapshots; run the verified audit server first.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const output = path.resolve('test-results/phase07/memory-scenarios')
fs.mkdirSync(output, { recursive: true })
const results = []
let browser
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.MARKUMO_CHROME })
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
  await page.goto('http://127.0.0.1:1494/test-results/phase07/browser-harness.html')
  await page.waitForFunction(() => window.f?.ready())
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const sample = async name => {
    await cdp.send('HeapProfiler.collectGarbage')
    const heap = (await cdp.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'JSHeapUsedSize').value
    results.push({ name, heapBytes: heap, dom: await cdp.send('Memory.getDOMCounters'), views: await page.evaluate(() => window.f.snapshot()) })
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  }
  for (const [name, source] of [
    ['ordinary-markdown', '# Ordinary\n\n' + 'Paragraph.\n\n'.repeat(100)],
    ['large-markdown-50000-lines', Array.from({ length: 25000 }, (_, i) => `Paragraph ${i} target.\n`).join('\n')],
    ['code-blocks', '```js\nconst n = 1\n```\n\n'.repeat(40)],
    ['image-references', '![pixel](./assets/pixel.png)\n\n'.repeat(40)],
  ]) {
    await page.evaluate(source => window.f.reset(source), source)
    await page.waitForFunction(() => window.f.ready())
    if (name === 'image-references') await page.waitForFunction(() => [...document.querySelectorAll('.md-live-image img')].every(img => img.naturalWidth > 0))
    await sample(name)
  }
  await page.evaluate(() => window.f.reset('# Split\n\nParagraph.\n')); await page.waitForFunction(() => window.f.ready())
  await page.evaluate(() => window.f.split()); await page.waitForFunction(() => window.f.ready())
  await sample('two-live-panes')
  const disposed = await page.evaluate(() => window.f.dispose())
  assert(disposed.pmDestroyed && disposed.cmDestroyed && disposed.remaining === 0)
  await sample('disposed-editors')
  // Media host runs the actual Vue viewers, PDF worker and binary decoder.
  await page.goto('http://127.0.0.1:1494/scripts/media-harness.html')
  await page.waitForFunction(() => !!window.mediaTest)
  for (const name of ['single.pdf', 'transparent.png']) {
    await page.evaluate(name => window.mediaTest.open(name), name)
    await page.waitForFunction(name => name.endsWith('.pdf') ? !!document.querySelector('.pdf-page .textLayer span') : document.querySelector('.image-stage img')?.naturalWidth > 0, name)
    await cdp.send('HeapProfiler.collectGarbage')
    results.push({ name, heapBytes: (await cdp.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'JSHeapUsedSize').value,
      dom: await cdp.send('Memory.getDOMCounters'), resources: await page.evaluate(() => ({ workers: window.mediaTest.workers.size, blobs: window.mediaTest.blobs.size })) })
    await page.evaluate(() => window.mediaTest.close())
    await page.waitForFunction(() => window.mediaTest.workers.size === 0 && window.mediaTest.blobs.size === 0)
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  console.log('PASS production component heap/DOM snapshots: ordinary/large/code/image/split/disposed/PDF/image viewer')
} finally { await browser?.close() }
