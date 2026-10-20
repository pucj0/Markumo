// Component-handler timings, including browser automation/condition-wait cost.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const reverse = process.argv.includes('--reverse')
const output = path.resolve(`test-results/phase07/actions${reverse ? '-reverse' : ''}`)
fs.mkdirSync(output, { recursive: true })
const rows = [], source = '# Actions\n\nneedle target.\n\n| A | B |\n|---|---|\n| one | two |\n\n' + Array.from({ length: 500 }, (_, i) => `Paragraph ${i}.\n`).join('\n')
let browser
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.MARKUMO_CHROME })
  const builds = [['baseline', 1490], ['final', 1491]]
  for (const [label, port] of reverse ? builds.reverse() : builds) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
    page.setDefaultTimeout(15000)
    await page.goto(`http://127.0.0.1:${port}/test-results/phase07/browser-harness.html`)
    const ready = () => page.waitForFunction(() => {
      const f = window.f, active = f?.manager.activeId, editor = f?.manager.liveViews.get('main')
      return !!(active && editor?.id === active && editor.editor.bridge.source === f.manager.getText(active))
    })
    await page.waitForFunction(() => !!window.f)
    const reset = async () => { await page.evaluate(source => window.f.reset(source), source); await ready() }
    const record = async (action, work) => {
      const samples = []
      for (let i = 0; i < 26; i++) {
        const start = performance.now(); await work(i)
        if (i) samples.push(performance.now() - start)
      }
      rows.push({ label, action, unit: 'ms; one warm-up excluded, automation and readiness cost included', samples })
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(rows, null, 2))
      console.log(`PASS ${label} ${action} 25 samples`)
    }
    await reset()
    await record('search-open-fill-match-close', async () => {
      await page.evaluate(() => window.f.manager.command('find'))
      await page.getByRole('textbox', { name: '查找', exact: true }).fill('needle')
      await page.waitForFunction(() => /1\s*\/\s*1/.test(document.querySelector('.md-live-search .search-count')?.textContent || ''))
      await page.getByRole('button', { name: '关闭查找 (Esc)', exact: true }).click()
      await page.locator('.md-live-search').waitFor({ state: 'hidden' })
    })
    await reset()
    await record('mode-live-source-live', async () => {
      await page.evaluate(() => window.f.manager.setMarkdownMode(window.f.id, 'source', 'main'))
      await page.locator('[data-pane="main"] > .cm-editor').waitFor()
      await page.evaluate(() => window.f.manager.setMarkdownMode(window.f.id, 'live', 'main'))
      await ready()
    })
    await reset()
    await page.evaluate(() => {
      const f = window.f, other = f.manager.createUntitled('md')
      f.manager.dispatch(other, { changes: { from: 0, insert: '# Other\n\nSecond tab.\n' } })
      f.manager.pin(other); window.otherTab = other; f.manager.select(f.id)
    })
    await ready()
    await record('canonical-tab-round-trip', async () => {
      await page.evaluate(() => window.f.manager.select(window.otherTab)); await ready()
      await page.evaluate(() => window.f.manager.select(window.f.id)); await ready()
    })
    await reset()
    await record('viewport-resize-round-trip', async () => {
      await page.setViewportSize({ width: 900, height: 850 })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(true))))
      await page.setViewportSize({ width: 1280, height: 850 })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(true))))
    })
    await reset()
    await page.locator('.md-prose td').first().click()
    const toolbar = page.locator('.md-table-tools.is-active').first()
    await record('table-toolbar-menu-round-trip', async () => {
      await toolbar.getByRole('button', { name: '表格行列操作', exact: true }).click()
      await toolbar.getByRole('button', { name: '后插行', exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await toolbar.getByRole('button', { name: '后插行', exact: true }).waitFor({ state: 'hidden' })
    })
    assert.equal(await page.evaluate(() => window.f.source()), source)
    await page.close()
  }
} finally { await browser?.close() }
