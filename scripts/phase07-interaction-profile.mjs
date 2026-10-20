// Trusted browser key events on the two frozen production component builds.
// Run while the baseline/final audit preview servers are alive.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const output = path.resolve('test-results/phase07/interaction')
fs.mkdirSync(output, { recursive: true })
const results = []
let browser
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.MARKUMO_CHROME,
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
  for (const [label, port] of [['baseline', 1477], ['final', 1480]]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
    await page.goto(`http://127.0.0.1:${port}/test-results/phase07/browser-harness.html`)
    await page.waitForFunction(() => !!(window.f?.ready() && window.f.live()))
    await page.evaluate(() => {
      window.keyFrames = []
      document.addEventListener('keydown', event => {
        if (!['q', 'Backspace'].includes(event.key)) return
        const start = performance.now(), key = event.key
        requestAnimationFrame(() => window.keyFrames.push({ key, ms: performance.now() - start }))
      }, true)
    })
    for (const kind of ['text', 'live']) for (const lines of [1000, 10000, 50000]) {
      await page.evaluate(({ kind, lines }) => {
        const f = window.f
        const text = kind === 'live' ? Array.from({ length: lines / 2 }, (_, i) => `Paragraph ${i} target.\n`).join('\n')
          : Array.from({ length: lines }, (_, i) => `Line ${i} ordinary text`).join('\n')
        f.reset(kind === 'live' ? text : '')
        if (kind === 'text') {
          f.manager.setMarkdownMode(f.id, 'source', 'main'); f.manager.setLanguage(f.id, 'Plain Text')
          f.manager.dispatch(f.id, { changes: { from: 0, insert: text }, annotations: f.CMTransaction.addToHistory.of(false) })
        }
        window.keyFrames = []
      }, { kind, lines })
      if (kind === 'live') await page.waitForFunction(() => window.f.ready())
      else await page.locator('[data-pane="main"] > .cm-editor').waitFor()
      await page.evaluate(kind => {
        if (kind === 'live') window.f.live('main').view.focus()
        else window.f.CMView.findFromDOM(document.querySelector('[data-pane="main"] > .cm-editor')).focus()
        window.sourceBeforeKeys = window.f.source()
      }, kind)
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press('q')
        await page.waitForFunction(n => window.keyFrames.length >= n, i * 2 + 1)
        await page.keyboard.press('Backspace')
        await page.waitForFunction(n => window.keyFrames.length >= n, i * 2 + 2)
      }
      assert(await page.evaluate(() => window.f.source() === window.sourceBeforeKeys), 'Native key pairs must preserve the canonical source')
      const samples = await page.evaluate(() => window.keyFrames)
      results.push({ label, kind, lines, samples, metric: 'capturing trusted keydown to next requestAnimationFrame callback; not pixel-present timing' })
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
      console.log(`PASS trusted key events ${label} ${kind} ${lines}`)
      if (kind === 'live' && lines === 50000) {
        await page.evaluate(() => { window.f.caret('Paragraph 0 target.'); window.f.insert(' PROFILE') })
        const cdp = await page.context().newCDPSession(page)
        await cdp.send('Profiler.enable'); await cdp.send('Profiler.start')
        await page.evaluate(() => { window.f.undo(); window.f.redo() })
        const { profile } = await cdp.send('Profiler.stop')
        fs.writeFileSync(path.join(output, `${label}-undo-redo.cpuprofile`), JSON.stringify(profile))
        const nodes = new Map(profile.nodes.map(node => [node.id, node.callFrame]))
        const totals = new Map()
        profile.samples.forEach((id, i) => {
          const frame = nodes.get(id), key = `${frame.functionName || '(anonymous)'} ${frame.url}:${frame.lineNumber + 1}`
          totals.set(key, (totals.get(key) || 0) + profile.timeDeltas[i] / 1000)
        })
        fs.writeFileSync(path.join(output, `${label}-cpu-summary.json`), JSON.stringify([...totals].sort((a, b) => b[1] - a[1]).slice(0, 30), null, 2))
      }
    }
    await page.close()
  }
} finally { await browser?.close() }
