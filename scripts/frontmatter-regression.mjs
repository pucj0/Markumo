// Front Matter Visual Card and Incremental Update Regression Suite
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'test-results/frontmatter'
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
  server: { host: '127.0.0.1', port: 1446, strictPort: true, hmr: false, watch: null }
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

  await page.goto('http://127.0.0.1:1446/test-results/frontmatter/index.html', { timeout: 45000 })
  await page.waitForFunction(() => !!window.f?.ready())

  // Test 1: YAML Front Matter renders as visual metadata card with fields
  await test('1. YAML Front Matter parses into visual metadata card with title and tags', async () => {
    const source = [
      '---',
      'title: 示例文档',
      'tags:',
      '  - Markdown',
      '  - Editor',
      'status: draft',
      'created: 2026-10-22',
      '---',
      '',
      '# 正文第一章',
      '正文内容。',
      ''
    ].join('\n')

    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => !!window.f?.ready())
    await page.waitForFunction(() => !!document.querySelector('.md-frontmatter-card'))

    const cardTitle = await page.inputValue('.md-frontmatter-title-input')
    assert.equal(cardTitle, '示例文档')

    const tags = await page.evaluate(() => {
      return [...document.querySelectorAll('.md-frontmatter-tag-badge')].map(el => el.textContent?.trim())
    })
    assert.deepEqual(tags, ['#Markdown', '#Editor'])

    const statusText = await page.locator('.md-frontmatter-status-val').innerText()
    assert.equal(statusText, 'draft')
  })

  // Test 2: In-place field editing updates YAML source incrementally with Undo/Redo
  await test('2. Editing metadata field updates YAML source incrementally and supports Undo', async () => {
    const source = [
      '---',
      'title: 原标题',
      '# 核心作者注释',
      'status: draft',
      '---',
      '',
      '正文段落。'
    ].join('\n')

    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => !!window.f?.ready())
    await page.waitForFunction(() => !!document.querySelector('.md-frontmatter-title-input'))

    // Update title field via input
    await page.locator('.md-frontmatter-title-input').fill('新标题（已修改）')
    await page.evaluate(() => {
      const input = document.querySelector('.md-frontmatter-title-input')
      input?.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await page.waitForFunction(() => window.f.source().includes('title: 新标题（已修改）'))
    const updatedSource = await page.evaluate(() => window.f.source())
    assert.ok(updatedSource.includes('# 核心作者注释'), 'Preserves comments in YAML')
    assert.ok(updatedSource.includes('status: draft'))

    // Undo restores previous title
    await page.evaluate(() => window.f.undo())
    await page.waitForFunction(() => window.f.source().includes('title: 原标题'))
  })

  // Test 3: Source fidelity: untouched Front Matter round-trips identically
  await test('3. Source fidelity: untouched YAML Front Matter round-trips identically across Live/Source', async () => {
    const original = '---\ntitle: 保真测试\ncustom: 12345\n---\n\n# 标题\n'
    await page.evaluate(src => window.f.reset(src, true), original)
    await page.waitForFunction(() => !!window.f?.ready())

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

  // Test 4: Invalid YAML displays non-blocking friendly hint and allows editing raw source
  await test('4. Invalid or irregular YAML provides non-blocking hint and edit-raw button', async () => {
    const source = '---\n[invalid: { yaml : syntax :\n---\n\n正文。'
    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => !!window.f?.ready())
    await page.waitForFunction(() => !!document.querySelector('.md-frontmatter-edit-raw'))

    const hasEditRaw = await page.locator('.md-frontmatter-edit-raw').count()
    assert.equal(hasEditRaw, 1)
  })

  console.log(`========================================`)
  console.log(`All ${results.length} Front Matter regression tests passed successfully!`)
  console.log(`========================================`)

} finally {
  await browser?.close()
  await server.close()
}
