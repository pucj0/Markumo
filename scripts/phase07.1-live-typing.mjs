// Phase 07.1: re-measure 50k-line Live typing on the frozen builds.
// Trusted keydown -> next rAF, alternating build order for three rounds.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=')[1]
const targetArgs = process.argv.filter(value => value.startsWith('--target='))
const targets = (targetArgs.length ? targetArgs : [
  '--target=baseline:1477',
  '--target=final-vite5:1480',
  '--target=final-vite6:1483',
]).map(value => {
  const [label, port] = value.slice('--target='.length).split(':')
  assert.match(label, /^[a-zA-Z0-9_-]+$/)
  assert(Number.isInteger(Number(port)) && Number(port) >= 1024)
  return { label, port: Number(port) }
})
const rounds = Number(arg('rounds') || 3)
assert(Number.isInteger(rounds) && rounds >= 3)
const output = path.resolve(arg('output') || 'test-results/phase07.1/live-typing/results.json')
fs.mkdirSync(path.dirname(output), { recursive: true })

const stats = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    n: sorted.length,
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  }
}
const text = Array.from({ length: 25000 }, (_, i) => `Paragraph ${i} target.\n`).join('\n')
const report = {
  mode: 'production-built component hosts / Chromium / trusted keyboard events; NOT native desktop',
  startedAt: new Date().toISOString(),
  node: process.version,
  chromePath: process.env.MARKUMO_CHROME || null,
  os: { platform: process.platform, arch: process.arch, cpus: os.cpus().length, totalMem: os.totalmem(), freeMem: os.freemem() },
  textSha256: null,
  lines: text.split('\n').length,
  chars: text.length,
  rounds,
  results: [],
  errors: [],
}
const { createHash } = await import('node:crypto')
report.textSha256 = createHash('sha256').update(text).digest('hex')
const persist = () => fs.writeFileSync(output, JSON.stringify(report, null, 2))

let browser
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.MARKUMO_CHROME,
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  })
  report.browser = browser.version()
  for (let round = 0; round < rounds; round++) {
    // Reverse the order on every other round, so cache/thermal drift cannot
    // systematically favour one build.
    const order = round % 2 ? [...targets].reverse() : targets
    for (const target of order) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 850 } })
      const page = await context.newPage()
      page.on('pageerror', error => report.errors.push(`${target.label}: ${error}`))
      const startUrl = `http://127.0.0.1:${target.port}/test-results/phase07/browser-harness.html`
      await page.goto(startUrl)
      await page.waitForFunction(() => !!(window.f?.ready() && window.f.live()), null, { timeout: 30000 })
      await page.evaluate(() => {
        window.keyFrames = []
        window.audit.longTasks.length = 0
        document.addEventListener('keydown', event => {
          if (!['q', 'Backspace'].includes(event.key)) return
          const start = performance.now(), key = event.key
          requestAnimationFrame(() => window.keyFrames.push({ key, ms: performance.now() - start }))
        }, true)
      })
      const initStart = performance.now()
      await page.evaluate(value => window.f.reset(value), text)
      await page.waitForFunction(() => !!(window.f.ready() && window.f.live()?.view), null, { timeout: 30000 })
      await page.evaluate(() => window.f.caret('Paragraph 0 target.'))
      const initMs = performance.now() - initStart
      const before = await page.evaluate(() => window.f.source())
      assert.equal(before, text, 'fixture reset must expose the exact source')
      const pairs = 30
      for (let i = 0; i < pairs; i++) {
        await page.keyboard.press('q')
        await page.waitForFunction(n => window.keyFrames.length >= n, i * 2 + 1)
        await page.keyboard.press('Backspace')
        await page.waitForFunction(n => window.keyFrames.length >= n, i * 2 + 2)
      }
      const afterTyping = await page.evaluate(() => window.f.source())
      const keyFrames = await page.evaluate(() => window.keyFrames)
      const typingLongTasks = await page.evaluate(() => window.audit.longTasks.splice(0))
      const snapshot = await page.evaluate(() => window.f.snapshot())
      // Undo/redo after a real edit: verifies the history path still restores
      // source without rebuilding the whole editor state per keystroke.
      const undo = [], redo = []
      await page.evaluate(() => { window.f.caret('Paragraph 0 target.'); window.f.insert(' PROFILE') })
      const edited = await page.evaluate(() => window.f.source())
      for (let i = 0; i < 10; i++) {
        let start = performance.now()
        await page.evaluate(() => window.f.undo())
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
        undo.push(performance.now() - start)
        start = performance.now()
        await page.evaluate(() => window.f.redo())
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
        redo.push(performance.now() - start)
      }
      const afterRedo = await page.evaluate(() => window.f.source())
      assert.equal(afterTyping, text, `${target.label}: 30 typing pairs must restore canonical source`)
      assert.equal(afterRedo, edited, `${target.label}: redo must restore the edited source`)
      const input = keyFrames.filter(frame => frame.key === 'q').map(frame => frame.ms)
      const deletion = keyFrames.filter(frame => frame.key === 'Backspace').map(frame => frame.ms)
      report.results.push({
        round: round + 1,
        order: order.map(item => item.label),
        label: target.label,
        port: target.port,
        initMs,
        input,
        deletion,
        inputStats: stats(input),
        deletionStats: stats(deletion),
        undo,
        redo,
        undoStats: stats(undo),
        redoStats: stats(redo),
        sourceRestored: afterTyping === text,
        redoRestored: afterRedo === edited,
        longTasks: typingLongTasks,
        snapshot,
        freeMemAtStart: os.freemem(),
      })
      persist()
      console.log(`PASS ${target.label} round ${round + 1} inputMedian=${stats(input).median.toFixed(1)}ms inputP95=${stats(input).p95.toFixed(1)}ms undoMedian=${stats(undo).median.toFixed(1)}ms redoMedian=${stats(redo).median.toFixed(1)}ms`)
      await context.close()
    }
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
