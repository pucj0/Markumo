import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'test-results/code-block-virtualization'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><div id="app" style="display:flex;height:720px"></div><script type="module" src="/scripts/fixtures/markdown-live-controller.js"></script>')
const server = await createServer({ server: { host: '127.0.0.1', port: 1497, strictPort: true, hmr: false, watch: null } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.MARKUMO_CHROME })
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:1497/${output}/index.html`)
  await page.waitForFunction(() => window.f)
  const source = 'Ordinary paragraph.\n\n' + Array.from({ length: 200 }, (_, i) => `\`\`\`js\nconst value${i} = ${i};\nsecond line\n\`\`\`\n\n`).join('')
  await page.evaluate(source => window.f.reset(source, true), source)
  await page.waitForFunction(() => window.f.ready())
  await page.waitForTimeout(500)
  const result = await page.evaluate(async () => {
    const f = window.f, live = f.live(), codes = [...live.codeViews]
    let created = 0
    for (const code of codes) {
      const ensure = code.ensureEditor.bind(code)
      code.ensureEditor = () => { if (!code.existingEditor) created++; return ensure() }
    }
    const before = f.snapshot().cm, history = f.history()
    for (let i = 0; i < 1000; i++) {
      void f.manager.isComposing
      live.toolbarState()
      live.searchController.updateCount()
      for (const code of codes) { void code.isComposing; void code.hasFocus; void code.existingEditor }
    }
    // Updating search decorations and settings is also a state-only operation.
    for (const code of codes) code.setSearchHighlights([{ from: 0, to: 5, current: false }])
    live.bracketMode('matching'); live.caretAnimation('off')
    await Promise.resolve()
    return { created, before, after: f.snapshot().cm, history, afterHistory: f.history(), count: codes.length }
  })
  assert.equal(result.count, 200)
  assert.equal(result.created, 0, '1000 state queries and search highlights must not instantiate CM')
  assert.equal(result.after, result.before)
  assert.deepEqual(result.afterHistory, result.history)
  assert.equal(await page.evaluate(() => window.f.source()), source)
  await page.locator('.md-prose > p').first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' continuous ordinary input')
  await page.waitForFunction(() => window.f.source().includes('continuous ordinary input'))
  await page.evaluate(() => window.f.undo())
  await page.waitForFunction(source => window.f.source() === source, source)
  assert.deepEqual(errors, [])
  fs.writeFileSync(`${output}/state-queries.json`, JSON.stringify(result, null, 2))
  console.log('PASS 200 code blocks: 1000 state queries, search decorations, ordinary typing and canonical undo')
} finally { await browser?.close(); await server.close() }
