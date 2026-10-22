// Callout Native Structured Editing Regression Suite
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'test-results/callout'
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
  server: { host: '127.0.0.1', port: 1441, strictPort: true, hmr: false, watch: null }
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

  await page.goto('http://127.0.0.1:1441/test-results/callout/index.html', { timeout: 45000 })
  await page.waitForFunction(() => !!window.f?.ready())

  // Test 1: All 5 GitHub-style Callout types parse into structured CalloutNodeViews
  await test('1. All 5 Callout types (NOTE, TIP, IMPORTANT, WARNING, CAUTION) parse and render', async () => {
    const source = [
      '> [!NOTE]',
      '> 说明内容',
      '',
      '> [!TIP] 自定义技巧标题',
      '> 技巧内容',
      '',
      '> [!IMPORTANT]',
      '> 重要注意事项',
      '',
      '> [!WARNING]',
      '> 警告信息',
      '',
      '> [!CAUTION]',
      '> 危险警告内容',
      ''
    ].join('\n')

    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => document.querySelectorAll('.md-callout-node').length === 5)

    const types = await page.evaluate(() => {
      return [...document.querySelectorAll('.md-callout-node')].map(el => el.getAttribute('data-callout-type'))
    })
    assert.deepEqual(types, ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'])

    // Verify custom title
    const tipTitle = await page.evaluate(() => {
      const tip = document.querySelector('.md-callout-tip .md-callout-title')
      return tip?.textContent?.trim()
    })
    assert.equal(tipTitle, '自定义技巧标题')
  })

  // Test 2: Source fidelity round-trip without edits
  await test('2. Source fidelity: untouched Callouts round-trip identically across Live/Source/Split', async () => {
    const original = '> [!NOTE] 核心提示\n> 第一段文本。\n> \n> 第二段文本。\n'
    await page.evaluate(src => window.f.reset(src, true), original)
    await page.waitForFunction(() => !!document.querySelector('.md-callout-node'))

    // Switch Live -> Source -> Live
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
    await page.waitForFunction(() => !!document.querySelector('.md-callout-node'))
    assert.equal(await page.evaluate(() => window.f.source().trim()), original.trim())
  })

  // Test 3: Native text editing inside Callout body and Undo/Redo
  await test('3. Native text editing inside Callout body supports typing, undo and redo', async () => {
    const initial = '> [!TIP]\n> 初始正文\n'
    await page.evaluate(src => window.f.reset(src, false), initial)
    await page.waitForFunction(() => !!document.querySelector('.md-callout-content p'))

    // Insert text directly inside callout content
    await page.evaluate(() => {
      const p = document.querySelector('.md-callout-content p')
      window.f.caret('初始正文', true)
      window.f.insert(' · 追加编辑')
    })
    await page.waitForFunction(() => window.f.source().includes('追加编辑'))
    const currentSrc = await page.evaluate(() => window.f.source())
    console.log('ACTUAL SERIALIZED SOURCE:', JSON.stringify(currentSrc))
    assert.ok(currentSrc.includes('追加编辑'))
    assert.ok(currentSrc.includes('> [!TIP]'))

    // Undo restores initial text
    await page.evaluate(() => window.f.undo())
    await page.waitForFunction(() => !window.f.source().includes('追加编辑'))
    assert.ok(await page.evaluate(() => window.f.source().includes('> [!TIP]\n> 初始正文')))

    // Redo restores edit
    await page.evaluate(() => window.f.redo())
    await page.waitForFunction(() => window.f.source().includes('追加编辑'))
  })

  // Test 4: Switching type via CalloutNodeView interactive menu
  await test('4. Interactive type switching updates Callout type and serializes correctly', async () => {
    const src = '> [!NOTE]\n> 需要注意的事项\n'
    await page.evaluate(src => window.f.reset(src, false), src)
    await page.waitForFunction(() => !!window.f.ready())
    await page.waitForFunction(() => !!document.querySelector('.md-callout-note'))

    // Trigger type button click
    await page.locator('.md-callout-type-btn').click()
    await page.waitForSelector('.md-callout-menu')

    const warnItem = page.locator('.md-callout-menu-item').filter({ hasText: 'WARNING' })
    await warnItem.click()
    await page.waitForFunction(() => !!document.querySelector('.md-callout-warning'))

    // Verify serialized output now starts with > [!WARNING]
    const updatedSource = await page.evaluate(() => window.f.source())
    assert.ok(updatedSource.includes('> [!WARNING]'))
  })

  // Test 5: Callout containing nested list and code block
  await test('5. Nested rich content (lists, code blocks) inside Callout preserved', async () => {
    const rich = [
      '> [!IMPORTANT]',
      '> 列表与代码测试：',
      '> - 列表项 1',
      '> - 列表项 2',
      '> ',
      '> ```js',
      '> const x = 10;',
      '> ```',
      ''
    ].join('\n')

    await page.evaluate(src => window.f.reset(src, false), rich)
    await page.waitForFunction(() => !!document.querySelector('.md-callout-important'))

    const hasList = await page.evaluate(() => !!document.querySelector('.md-callout-important ul'))
    const hasCode = await page.evaluate(() => !!document.querySelector('.md-callout-important pre, .md-callout-important .md-code-block'))
    assert.equal(hasList, true)
    assert.equal(hasCode, true)
  })

  // Test 6: 普通 blockquote 仍然正常工作，不被误判为 Callout
  await test('6. Ordinary blockquote is not hijacked and continues normal behavior', async () => {
    const ordinary = '> 这是一段普通的引用文字。\n> 第二行引用。\n'
    await page.evaluate(src => window.f.reset(src, false), ordinary)
    await page.waitForFunction(() => !!document.querySelector('blockquote'))

    const isCallout = await page.evaluate(() => !!document.querySelector('.md-callout-node'))
    const isBlockquote = await page.evaluate(() => !!document.querySelector('blockquote:not(.md-callout-node)'))
    assert.equal(isCallout, false)
    assert.equal(isBlockquote, true)
  })

  console.log(`========================================`)
  console.log(`All ${results.length} Callout regression tests passed successfully!`)
  console.log(`========================================`)

} finally {
  await browser?.close()
  await server.close()
}
