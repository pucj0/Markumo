// Investigate the table-fixture input tail without rebuilding either snapshot.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { preview } from 'vite'
import { chromium } from 'playwright'

const source = '| A | B |\n|---|---|\n| one | two |\n\n'.repeat(30)
const builds = [
  { label: 'baseline', directory: 'browser-dist', port: 1498 },
  { label: 'final', directory: 'browser-dist-delivery-clean', port: 1499 },
]
const servers = [], rows = []
let browser
try {
  for (const build of builds) servers.push(await preview({ logLevel: 'silent', build: { outDir: `test-results/phase07/${build.directory}` }, preview: { host: '127.0.0.1', port: build.port, strictPort: true } }))
  browser = await chromium.launch({ headless: true, executablePath: process.env.MARKUMO_CHROME })
  for (const [order, sequence] of [['reverse', [...builds].reverse()], ['forward', builds]]) for (const build of sequence) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
    await page.goto(`http://127.0.0.1:${build.port}/test-results/phase07/browser-harness.html`)
    await page.waitForFunction(() => !!window.f)
    await page.evaluate(source => window.f.reset(source), source)
    await page.waitForFunction(() => !!window.f.ready())
    const result = await page.evaluate(async () => {
      const f = window.f, view = f.live('main').view, values = []
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
      window.audit.longTasks.length = 0
      for (let i = 0; i < 100; i++) {
        const start = performance.now()
        view.dispatch(view.state.tr.insertText('x', 1).setMeta('isolated', true))
        await frame(); values.push(performance.now() - start)
        f.undo(); await frame(); f.redo(); await frame()
        view.dispatch(view.state.tr.delete(1, 2).setMeta('isolated', true)); await frame()
        view.dispatch(view.state.tr.setSelection(f.TextSelection.create(view.state.doc, 1))); await frame()
        f.live('main').dom.scrollTop = i * 100; await frame()
      }
      return { values, source: f.source(), longTasks: window.audit.longTasks }
    })
    const sorted = [...result.values].sort((a, b) => a - b)
    rows.push({ order, label: build.label, datasetSha256: createHash('sha256').update(source).digest('hex'), ...result,
      stats: { n: sorted.length, min: sorted[0], median: (sorted[49] + sorted[50]) / 2, p95: sorted[94], max: sorted.at(-1) } })
    await page.close()
  }
  assert(rows.every(row => row.source === rows[0].source), 'Identical benchmark operations must leave identical canonical source on both builds')
  fs.writeFileSync('test-results/phase07/table-tail.json', JSON.stringify(rows, null, 2))
  console.log(rows.map(({ order, label, stats }) => ({ order, label, stats })))
} finally {
  await browser?.close()
  for (const server of servers) await new Promise(resolve => server.httpServer.close(resolve))
}
