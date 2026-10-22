// TOC Native Dynamic Catalog Regression Suite
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'test-results/toc'
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
  server: { host: '127.0.0.1', port: 1442, strictPort: true, hmr: false, watch: null }
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

  await page.goto('http://127.0.0.1:1442/test-results/toc/index.html', { timeout: 45000 })
  await page.waitForFunction(() => !!window.f?.ready())

  // Test 1: [TOC] parses into native TocNodeView and renders extracted headings
  await test('1. [TOC] parses into native TocNodeView and dynamically extracts H1-H6', async () => {
    const source = [
      '[TOC]',
      '',
      '# 第一章 概述',
      '正文内容 1',
      '',
      '## 1.1 架构设计',
      '正文内容 2',
      '',
      '### 1.1.1 核心组件',
      '正文内容 3',
      '',
      '# 第二章 部署实践',
      '正文内容 4',
      ''
    ].join('\n')

    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => !!window.f?.ready())
    await page.waitForFunction(() => document.querySelectorAll('.md-toc-item').length === 4)

    const items = await page.evaluate(() => {
      return [...document.querySelectorAll('.md-toc-item .md-toc-text')].map(el => el.textContent?.trim())
    })
    assert.deepEqual(items, ['第一章 概述', '1.1 架构设计', '1.1.1 核心组件', '第二章 部署实践'])
  })

  // Test 2: Source fidelity round trip without edits: [TOC] is perfectly preserved
  await test('2. Source fidelity: [TOC] marker is retained and does not serialize generated list to disk', async () => {
    const original = '[TOC]\n\n# 模块 A\n内容 A\n\n## 模块 B\n内容 B\n'
    await page.evaluate(src => window.f.reset(src, true), original)
    await page.waitForFunction(() => !!window.f?.ready())

    // Live -> Source -> Live
    await page.evaluate(() => {
      const m = window.f.manager, id = window.f.id
      m.setMarkdownMode(id, 'source')
    })
    await page.waitForFunction(() => !!document.querySelector('.cm-content'))
    const sourceContent = await page.evaluate(() => window.f.source())
    assert.equal(sourceContent.trim(), original.trim())

    await page.evaluate(() => {
      const m = window.f.manager, id = window.f.id
      m.setMarkdownMode(id, 'live')
    })
    await page.waitForFunction(() => !!window.f?.ready())
    assert.equal(await page.evaluate(() => window.f.source().trim()), original.trim())
  })

  // Test 3: Dynamic update when headings change, without creating extra Undo history
  await test('3. Heading edits dynamically update TOC without polluting Undo history', async () => {
    const source = '[TOC]\n\n# 原始标题\n正文\n'
    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => !!window.f?.ready())
    await page.waitForFunction(() => document.querySelectorAll('.md-toc-item').length === 1)

    // Edit the heading text in Live mode
    await page.evaluate(() => {
      window.f.caret('原始标题', true)
      window.f.insert('（已更新）')
    })
    await page.waitForFunction(() => window.f.source().includes('已更新'))

    // Verify TOC automatically reflects the updated heading
    await page.waitForFunction(() => document.querySelector('.md-toc-item')?.textContent?.includes('已更新'))

    // Undo should restore heading in one step
    await page.evaluate(() => window.f.undo())
    await page.waitForFunction(() => !window.f.source().includes('已更新'))
    await page.waitForFunction(() => !document.querySelector('.md-toc-item')?.textContent?.includes('已更新'))
  })

  // Test 4: Clicking TOC item navigates and focuses heading
  await test('4. Clicking TOC item navigates cursor to matching heading position', async () => {
    const source = '[TOC]\n\n# 目标标题\n正文内容\n'
    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => !!window.f?.ready())
    await page.waitForFunction(() => !!document.querySelector('.md-toc-item'))

    await page.locator('.md-toc-item').first().click()
    const selectionMatches = await page.evaluate(() => {
      const view = window.f.live().view
      const pos = view.state.selection.from
      const textAt = view.state.doc.textBetween(pos, Math.min(view.state.doc.content.size, pos + 4))
      return textAt.includes('目标')
    })
    assert.equal(selectionMatches, true)
  })

  // Test 5: Empty headings list shows friendly empty placeholder
  await test('5. Document without headings shows friendly empty placeholder', async () => {
    const source = '[TOC]\n\n这里是一段没有标题的普通文本内容。\n'
    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => !!window.f?.ready())
    await page.waitForFunction(() => !!document.querySelector('.md-toc-empty'))

    const emptyText = await page.locator('.md-toc-empty').innerText()
    assert.ok(emptyText.includes('暂无标题'))
  })

  // Test 6: Delete TOC button removes the TOC node
  await test('6. Delete TOC button removes [TOC] block from document cleanly', async () => {
    const source = '[TOC]\n\n# 标题一\n正文\n'
    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => !!window.f?.ready())
    await page.waitForFunction(() => !!document.querySelector('.md-toc-delete-btn'))

    await page.locator('.md-toc-delete-btn').click()
    await page.waitForFunction(() => document.querySelectorAll('.md-toc-block').length === 0)

    const updatedSource = await page.evaluate(() => window.f.source())
    assert.ok(!updatedSource.includes('[TOC]'))
    assert.ok(updatedSource.includes('# 标题一'))
  })

  console.log(`========================================`)
  console.log(`All ${results.length} TOC regression tests passed successfully!`)
  console.log(`========================================`)

} finally {
  await browser?.close()
  await server.close()
}
