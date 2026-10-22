// Footnote Native Structured Editing Regression Suite
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'test-results/footnote'
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
  server: { host: '127.0.0.1', port: 1443, strictPort: true, hmr: false, watch: null }
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

  await page.goto('http://127.0.0.1:1443/test-results/footnote/index.html', { timeout: 45000 })
  await page.waitForFunction(() => !!window.f?.ready())

  // Test 1: Numbered and named footnotes parse into native FootnoteDefNodeView
  await test('1. Numbered and named footnote definitions parse into native FootnoteDefNodeViews', async () => {
    const source = [
      '正文中的第一处引用[^1]，以及命名引用[^note]。',
      '',
      '[^1]: 这是数字脚注的详细说明内容。',
      '',
      '[^note]: 这是命名脚注的详细说明内容。',
      ''
    ].join('\n')

    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => !!window.f?.ready())
    await page.waitForFunction(() => document.querySelectorAll('.md-footnote-def-node').length === 2)

    const labels = await page.evaluate(() => {
      return [...document.querySelectorAll('.md-footnote-def-node')].map(el => el.getAttribute('data-footnote-label'))
    })
    assert.deepEqual(labels, ['1', 'note'])

    const contents = await page.evaluate(() => {
      return [...document.querySelectorAll('.md-footnote-def-content p')].map(el => el.textContent?.trim())
    })
    assert.deepEqual(contents, ['这是数字脚注的详细说明内容。', '这是命名脚注的详细说明内容。'])
  })

  // Test 2: Source fidelity round trip without edits: [^1]: content is preserved identically
  await test('2. Source fidelity: untouched footnote definitions round-trip identically across Live/Source/Live', async () => {
    const original = '这里是一段带脚注的正文[^1]。\n\n[^1]: 保持未编辑的脚注原样。\n'
    await page.evaluate(src => window.f.reset(src, true), original)
    await page.waitForFunction(() => !!window.f?.ready())

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
    await page.waitForFunction(() => !!window.f?.ready())
    assert.equal(await page.evaluate(() => window.f.source().trim()), original.trim())
  })

  // Test 3: Native text editing inside footnote definition body with Undo/Redo
  await test('3. Native text editing inside footnote definition supports typing, undo and redo', async () => {
    const source = '参考资料[^1]。\n\n[^1]: 初始资料说明\n'
    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => !!window.f?.ready())
    await page.waitForFunction(() => !!document.querySelector('.md-footnote-def-content p'))

    // Direct text editing inside footnote body
    await page.evaluate(() => {
      window.f.caret('初始资料说明', true)
      window.f.insert('（补充附录）')
    })
    await page.waitForFunction(() => window.f.source().includes('补充附录'))
    assert.ok(await page.evaluate(() => window.f.source().includes('[^1]: 初始资料说明（补充附录）')))

    // Undo restores initial text
    await page.evaluate(() => window.f.undo())
    await page.waitForFunction(() => !window.f.source().includes('补充附录'))
    assert.ok(await page.evaluate(() => window.f.source().includes('[^1]: 初始资料说明')))

    // Redo restores edit
    await page.evaluate(() => window.f.redo())
    await page.waitForFunction(() => window.f.source().includes('补充附录'))
  })

  // Test 4: Clicking footnote definition badge jumps back to inline footnote reference
  await test('4. Clicking footnote definition badge navigates cursor back to reference in body', async () => {
    const source = '前置段落文字。\n\n引用标记[^target]。\n\n后置正文段落。\n\n[^target]: 目标脚注定义内容。\n'
    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => !!window.f?.ready())
    await page.waitForFunction(() => !!document.querySelector('.md-footnote-def-badge'))

    // Click badge to jump to reference
    await page.locator('.md-footnote-def-badge').click()
    const isAtReference = await page.evaluate(() => {
      const view = window.f.live().view
      const pos = view.state.selection.from
      const nodeBefore = view.state.doc.resolve(pos).nodeBefore
      return nodeBefore?.type.name === 'footnote_reference' && nodeBefore.attrs.label === 'target'
    })
    assert.equal(isAtReference, true)
  })

  // Test 5: Multiple references sharing a single definition
  await test('5. Multiple references correctly share a single footnote definition', async () => {
    const source = '第一处引用[^shared]，第二处引用[^shared]。\n\n[^shared]: 共享定义内容。\n'
    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => !!window.f?.ready())
    await page.waitForFunction(() => document.querySelectorAll('.md-footnote').length === 2)
    await page.waitForFunction(() => document.querySelectorAll('.md-footnote-def-node').length === 1)

    const defContent = await page.locator('.md-footnote-def-content').innerText()
    assert.ok(defContent.includes('共享定义内容'))
  })

  // Test 6: Insert footnote via toolbar/controller creates linked reference & definition
  await test('6. Insert footnote command creates linked reference and definition atomically', async () => {
    const source = '在这一句末尾插入脚注。'
    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => !!window.f?.ready())

    await page.evaluate(() => {
      window.f.caret('插入脚注。', true)
      window.f.live().insertToolbar('footnote')
    })
    await page.waitForFunction(() => window.f.source().includes('[^1]'))
    await page.waitForFunction(() => window.f.source().includes('[^1]:'))

    const hasRef = await page.evaluate(() => document.querySelectorAll('.md-footnote').length === 1)
    const hasDef = await page.evaluate(() => document.querySelectorAll('.md-footnote-def-node').length === 1)
    assert.equal(hasRef, true)
    assert.equal(hasDef, true)
  })

  console.log(`========================================`)
  console.log(`All ${results.length} Footnote regression tests passed successfully!`)
  console.log(`========================================`)

} finally {
  await browser?.close()
  await server.close()
}
