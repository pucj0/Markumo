import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { checkMarkdownClicks } from './markdown-click-checks.mjs'
const { chromium } = createRequire(process.env.LIGHTEDIT_PLAYWRIGHT_PACKAGE || import.meta.url)('playwright')
const output = 'test-results/markdown-clicks'; await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: process.env.LIGHTEDIT_TEST_BROWSER || 'msedge' })
const page = await browser.newPage({ viewport: { width: 1200, height: 780 } }), errors = []
page.on('pageerror', e => errors.push(e.message))
let failure
try {
  await page.goto(process.env.LIGHTEDIT_TEST_URL || 'http://localhost:1422')
  await page.locator('.cm-content').waitFor()
  await checkMarkdownClicks(page, output)
  assert.deepEqual(errors, [])
  console.log('PASS 40 real Markdown clicks, edits/undo, scrolling, Live/Source/Split and paragraph spacing')
} catch (error) { failure = String(error); await page.screenshot({ path: `${output}/failure.png` }); throw error }
finally { await writeFile(`${output}/results.json`, JSON.stringify({ failure, errors }, null, 2)); await browser.close() }
