// Phase 07.1: explain the 50-cycle lifecycle DOM difference with real
// object/DOM lifetimes instead of relaxing the growth threshold.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=')[1]
const base = arg('base') || 'http://127.0.0.1:1486'
const output = path.resolve(arg('output') || 'test-results/phase07.1/lifecycle-diagnostic')
fs.mkdirSync(output, { recursive: true })
const cycleText = '# Lifecycle\n\nParagraph target.\n\n```js\nconst cycle = 1\n```\n\n| A | B |\n|---|---|\n| one | two |\n'
const report = {
  mode: 'production-built component host / Chromium / real dispose lifecycle',
  startedAt: new Date().toISOString(),
  base,
  cycles: [],
  errors: [],
}
const persist = () => fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2))

let browser
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.MARKUMO_CHROME,
    args: ['--js-flags=--expose-gc', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  })
  report.browser = browser.version()
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
  page.setDefaultTimeout(30000)
  page.on('pageerror', error => report.errors.push(String(error)))
  await page.goto(`${base}/test-results/phase07/browser-harness.html`)
  await page.waitForFunction(() => !!(window.f?.ready() && window.f.live()))
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const sample = async phase => {
    await cdp.send('HeapProfiler.collectGarbage')
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]))
    return {
      phase,
      heap: metrics.JSHeapUsedSize,
      dom: await cdp.send('Memory.getDOMCounters'),
      attached: await page.evaluate(() => document.querySelectorAll('*').length),
      snapshot: await page.evaluate(() => window.f.snapshot()),
    }
  }
  const heapSnapshot = async name => {
    const file = path.join(output, `${name}.heapsnapshot`), fd = fs.openSync(file, 'w')
    const write = ({ chunk }) => fs.writeSync(fd, chunk)
    cdp.on('HeapProfiler.addHeapSnapshotChunk', write)
    try { await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false }) }
    finally { cdp.off('HeapProfiler.addHeapSnapshotChunk', write); fs.closeSync(fd) }
  }
  let snapshotTaken = process.argv.includes('--no-snapshot')
  const cycles = Number(arg('cycles') || 50)
  for (let cycle = 1; cycle <= cycles; cycle++) {
    await page.evaluate(text => window.f.reset(text), cycleText)
    await page.waitForFunction(() => !!(window.f.ready() && window.f.live()?.view))
    await page.evaluate(() => window.f.split())
    await page.waitForFunction(() => !!(window.f.panes.length >= 2 && window.f.ready() && window.f.live(window.f.panes.at(-1))?.view))
    await page.locator('[data-pane="main"] .md-prose td').first().click()
    await page.locator('.md-table-tools.is-active').first().getByRole('button', { name: '表格行列操作', exact: true }).click()
    await page.keyboard.press('Escape')
    const disposed = await page.evaluate(() => window.f.dispose())
    assert(disposed.pmDestroyed && disposed.cmDestroyed && disposed.rootsRemoved && disposed.remaining === 0, `cycle ${cycle}: dispose contract`)
    const t0 = await sample('immediate')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const raf = await sample('next-frame')
    await page.waitForTimeout(50)
    const t50 = await sample('50ms')
    await page.waitForTimeout(450)
    const t500 = await sample('500ms')
    const row = { cycle, disposed, t0, raf, t50, t500 }
    report.cycles.push(row)
    if (!snapshotTaken && t0.dom.nodes > 100) {
      await heapSnapshot(`detached-cycle-${cycle}`)
      snapshotTaken = true
      row.snapshot = `detached-cycle-${cycle}.heapsnapshot`
    }
    persist()
    console.log(`cycle ${cycle}: immediate=${t0.dom.nodes} raf=${raf.dom.nodes} 50ms=${t50.dom.nodes} 500ms=${t500.dom.nodes} attached=${t0.attached} heapMiB=${(t0.heap / 1048576).toFixed(2)}`)
  }
  await heapSnapshot('after-50-cycles')
  const last = report.cycles.at(-1)
  for (const row of report.cycles) {
    assert(row.t500.dom.nodes <= 100, `cycle ${row.cycle}: detached DOM did not settle`)
    assert(row.t500.snapshot.pm === 0 && row.t500.snapshot.cm === 0 && row.t500.snapshot.toolbars === 0, `cycle ${row.cycle}: editor objects retained`)
  }
  report.summary = {
    immediateOver100: report.cycles.filter(row => row.t0.dom.nodes > 100).map(row => row.cycle),
    settledOver100: report.cycles.filter(row => row.t500.dom.nodes > 100).map(row => row.cycle),
    attachedRange: [Math.min(...report.cycles.map(row => row.t0.attached)), Math.max(...report.cycles.map(row => row.t0.attached))],
    heapStart: report.cycles[0].t500.heap,
    heapEnd: last.t500.heap,
  }
  report.completedAt = new Date().toISOString()
  report.passed = report.errors.length === 0
  persist()
} catch (error) {
  report.failure = String(error.stack || error)
  persist()
  throw error
} finally {
  await browser?.close()
}
