// Exact reproduction of the Phase 07 trusted-key loop for the 50k Live case,
// with three alternating rounds across the frozen builds.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const output = path.resolve('test-results/phase07.1/live-typing-exact')
fs.mkdirSync(output, { recursive: true })
const targets = [['baseline', 1477], ['final-vite5', 1480], ['final-vite6', 1483]]
const text = Array.from({ length: 25000 }, (_, i) => `Paragraph ${i} target.\n`).join('\n')
const report = { mode: 'Phase 07 interaction-profile loop; live/50000; 20 trusted pairs', startedAt: new Date().toISOString(), lines: 50000, sha256: null, rounds: [] }
const { createHash } = await import('node:crypto')
report.sha256 = createHash('sha256').update(text).digest('hex')
let browser
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.MARKUMO_CHROME,
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
  report.browser = browser.version()
  for (let round = 0; round < 3; round++) {
    const order = round % 2 ? [...targets].reverse() : targets
    for (const [label, port] of order) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
      await page.goto(`http://127.0.0.1:${port}/test-results/phase07/browser-harness.html`)
      await page.waitForFunction(() => !!(window.f?.ready() && window.f.live()))
      await page.evaluate(text => { window.f.reset(text) }, text)
      await page.waitForFunction(() => window.f.ready())
      await page.evaluate(() => {
        window.keyFrames = []
        document.addEventListener('keydown', event => {
          if (!['q', 'Backspace'].includes(event.key)) return
          const start = performance.now(), key = event.key
          requestAnimationFrame(() => window.keyFrames.push({ key, ms: performance.now() - start }))
        }, true)
        window.sourceBeforeKeys = window.f.source()
        window.f.live('main').view.focus()
      })
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press('q')
        await page.waitForFunction(n => window.keyFrames.length >= n, i * 2 + 1)
        await page.keyboard.press('Backspace')
        await page.waitForFunction(n => window.keyFrames.length >= n, i * 2 + 2)
      }
      const sourceRestored = await page.evaluate(() => window.f.source() === window.sourceBeforeKeys)
      const samples = await page.evaluate(() => window.keyFrames)
      const q = samples.filter(row => row.key === 'q').map(row => row.ms)
      const bs = samples.filter(row => row.key === 'Backspace').map(row => row.ms)
      const stats = values => {
        const sorted = [...values].sort((a, b) => a - b)
        return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1), p95: sorted[Math.ceil(sorted.length * .95) - 1] }
      }
      report.rounds.push({ round: round + 1, order: order.map(row => row[0]), label, port, sourceRestored, input: stats(q), deletion: stats(bs), samples })
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2))
      console.log(`PASS ${label} round ${round + 1} inputMedian=${stats(q).median.toFixed(1)} p95=${stats(q).p95.toFixed(1)} source=${sourceRestored}`)
      await page.close()
    }
  }
  report.completedAt = new Date().toISOString()
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2))
} finally { await browser?.close() }
