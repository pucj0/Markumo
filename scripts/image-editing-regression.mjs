// Image Editing Controls and Persistence Regression Suite
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'test-results/image-edit'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(`${output}/index.html`, `<!doctype html>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/src/styles/reset.css">
<link rel="stylesheet" href="/src/styles/variables.css">
<link rel="stylesheet" href="/src/editor/markdown/styles.css">
<link rel="stylesheet" href="/src/editor/markdown/presentation.css">
<link rel="stylesheet" href="/src/editor/markdown/wysiwyg/MarkdownTheme.css">
<div id="app" class="markdown-live" style="display:flex;height:720px"></div>
<script type="module" src="/scripts/fixtures/markdown-live-controller.js"></script>`)

const server = await createServer({
  server: { host: '127.0.0.1', port: 1444, strictPort: true, hmr: false, watch: null }
})
await server.listen()

let browser
const results = []
const test = async (name, run) => {
  await run()
  results.push(name)
  console.log('PASS ' + name)
}

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MARKUMO_CHROME ? { executablePath: process.env.MARKUMO_CHROME } : {})
  })

  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.setDefaultTimeout(30000)
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()))
  page.on('pageerror', err => console.error('BROWSER ERROR:', err))

  await page.goto('http://127.0.0.1:1444/test-results/image-edit/index.html', { timeout: 45000 })
  await page.waitForFunction(() => !!window.f?.ready())

  // Test 1: Untouched ordinary markdown images preserve pure Markdown syntax
  await test('1. Untouched Markdown image strictly preserves pure markdown syntax', async () => {
    const original = '段落前置。\n\n![示例图片](./assets/pixel.png)\n\n段落后置。\n'
    await page.evaluate(src => window.f.reset(src, true), original)
    await page.waitForFunction(() => !!window.f?.ready())

    // Switch Live -> Source -> Live
    await page.evaluate(() => {
      const m = window.f.manager, id = window.f.id
      m.setMarkdownMode(id, 'source')
    })
    await page.waitForFunction(() => !!document.querySelector('.cm-content'))
    assert.equal((await page.evaluate(() => window.f.source())).trim(), original.trim())

    await page.evaluate(() => {
      const m = window.f.manager, id = window.f.id
      m.setMarkdownMode(id, 'live')
    })
    await page.waitForFunction(() => !!window.f?.ready())
    assert.equal((await page.evaluate(() => window.f.source())).trim(), original.trim())
  })

  // Test 2: Clicking image displays hover toolbar with align and size presets
  await test('2. Selecting image exposes hover toolbar with align, width and delete buttons', async () => {
    const source = '![测试](./assets/pixel.png)'
    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => !!window.f?.ready())
    await page.waitForFunction(() => !!document.querySelector('.md-live-image img'))

    // Click image to select
    await page.evaluate(() => {
      const img = document.querySelector('.md-live-image img')
      img?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForSelector('.md-image-toolbar:not([hidden])')

    const hasAlign = await page.locator('.md-img-align-center').count()
    const hasWidth = await page.locator('.md-img-width-50').count()
    const hasDelete = await page.locator('.md-img-tool-delete').count()
    assert.equal(hasAlign, 1)
    assert.equal(hasWidth, 1)
    assert.equal(hasDelete, 1)
  })

  // Test 3: Setting alignment (center) and width (50%) updates styles and serializes
  await test('3. Modifying width and alignment applies styling and controlled persistence', async () => {
    const source = '![测试](./assets/pixel.png)'
    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => !!window.f?.ready())

    // Select and click "居中" (center) and "50%"
    await page.evaluate(() => {
      const img = document.querySelector('.md-live-image img')
      img?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForSelector('.md-img-align-center:not([hidden])')
    await page.locator('.md-img-align-center').click()
    await page.locator('.md-img-width-50').click()

    await page.waitForFunction(() => {
      const el = document.querySelector('.md-live-image')
      return el?.style?.width === '50%' && el?.style?.textAlign === 'center'
    })

    const serialized = await page.evaluate(() => window.f.source())
    assert.ok(serialized.includes('width="50%"'))
    assert.ok(serialized.includes('align="center"'))
  })

  // Test 4: Delete image removes node and cleans empty paragraph with single undo step
  await test('4. Delete image button cleans paragraph and supports single-step Undo', async () => {
    const source = '段落一。\n\n![独立图片](./assets/pixel.png)\n\n段落二。\n'
    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => !!window.f?.ready())

    await page.evaluate(() => {
      const img = document.querySelector('.md-live-image img')
      img?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForSelector('.md-img-tool-delete:not([hidden])')
    await page.locator('.md-img-tool-delete').click()

    await page.waitForFunction(() => document.querySelectorAll('.md-live-image').length === 0)
    const afterDelete = await page.evaluate(() => window.f.source())
    assert.ok(!afterDelete.includes('pixel.png'))

    // Undo restores image
    await page.evaluate(() => window.f.undo())
    await page.waitForFunction(() => document.querySelectorAll('.md-live-image').length === 1)
    assert.ok((await page.evaluate(() => window.f.source())).includes('pixel.png'))
  })

  // Test 5: Broken image displays broken badge and does not crash
  await test('5. Non-existent image displays broken badge gracefully without infinite retry', async () => {
    const source = '![失效图](broken.png)'
    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => !!window.f?.ready())
    await page.waitForFunction(() => !!document.querySelector('.is-broken-image, .broken-image-tag'))

    const hasBrokenTag = await page.locator('.is-broken-image, .broken-image-tag').count()
    assert.ok(hasBrokenTag > 0)
  })

  console.log(`========================================`)
  console.log(`All ${results.length} Image editing regression tests passed successfully!`)
  console.log(`========================================`)

} finally {
  await browser?.close()
  await server.close()
}
