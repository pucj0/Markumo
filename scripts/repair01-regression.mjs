// Repair 01: document-content injection, image attribute persistence and
// footnote navigation, verified against the real document model and DOM.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'test-results/repair01'
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
  server: { host: '127.0.0.1', port: 1465, strictPort: true, hmr: false, watch: null }
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
  const executed = []
  page.on('dialog', async dialog => { executed.push(dialog.message()); await dialog.dismiss() })
  page.on('pageerror', error => executed.push('pageerror:' + error.message))

  await page.goto('http://127.0.0.1:1465/test-results/repair01/index.html', { timeout: 45000 })
  await page.waitForFunction(() => !!window.f?.ready())

  const reset = async source => {
    await page.evaluate(src => window.f.reset(src, false), source)
    await page.waitForFunction(() => !!window.f?.ready())
    await page.waitForTimeout(50)
  }

  // --- Injection ---------------------------------------------------------

  await test('1. a hostile footnote label is rendered as text, never markup', async () => {
    await reset('[^<img src=x onerror=window.__xss=1>]: 脚注正文')
    const info = await page.evaluate(() => {
      const node = document.querySelector('.md-footnote-def-node')
      const badge = document.querySelector('.md-footnote-def-badge')
      return {
        injected: !!document.querySelector('.md-footnote-def-badge img'),
        badgeText: badge ? badge.textContent : null,
        hasNode: !!node,
        global: window.__xss || 0,
      }
    })
    assert.equal(info.hasNode, true, 'the definition still renders')
    assert.equal(info.injected, false, 'no injected element')
    assert.equal(info.global, 0)
    assert.ok(info.badgeText.includes('<img'), 'the label is shown verbatim as text')
  })

  await test('2. hostile YAML status and created values never become markup', async () => {
    await reset('---\nstatus: "<img src=x onerror=window.__yaml=1>"\ncreated: <b onmouseover=window.__yaml2=1>x</b>\n---\n\n正文')
    const info = await page.evaluate(() => ({
      card: !!document.querySelector('.md-frontmatter-card'),
      statusHtml: document.querySelector('.md-frontmatter-status-val')?.innerHTML ?? '',
      img: document.querySelectorAll('.md-frontmatter-card img').length,
      bold: document.querySelectorAll('.md-frontmatter-card b').length,
      global: window.__yaml || window.__yaml2 || 0,
    }))
    assert.equal(info.card, true)
    assert.equal(info.img, 0, 'no img element from metadata')
    assert.equal(info.bold, 0, 'no b element from metadata')
    assert.equal(info.global, 0)
    assert.ok(info.statusHtml.includes('&lt;img'), 'metadata is escaped text')
  })

  await test('3. an image destination cannot break out of the controlled attribute', async () => {
    const round = await page.evaluate(async () => {
      const { markdownSchema } = await import('/src/editor/markdown/wysiwyg/MarkdownSchema.ts')
      const { serializeBlock } = await import('/src/editor/markdown/wysiwyg/MarkdownSerializer.ts')
      const image = markdownSchema.nodes.image.create({ src: 'x" onerror="window.__img=1', alt: 'a"onload="1', title: null, width: '50%', align: null })
      return serializeBlock(markdownSchema.nodes.paragraph.create(null, image))
    })
    assert.ok(!/"\s+onerror="/.test(round), 'no unescaped handler attribute can appear')
    assert.ok(round.includes('&quot;'), 'quotes are escaped')
    assert.ok(round.startsWith('<img src="x&quot;'), 'the destination stays inside its own attribute')
    assert.equal(await page.evaluate(() => window.__img || 0), 0)
  })

  await test('4. hostile HTML in the document stays inert', async () => {
    await reset('<img src="x" onerror="window.__html=1" width="50%" />\n\n<script>window.__html2=1</script>')
    const info = await page.evaluate(() => {
      const doc = window.f.live().view.state.doc
      const kinds = []
      doc.forEach(node => kinds.push(node.type.name))
      return {
        kinds,
        handlerElements: document.querySelectorAll('.md-prose [onerror]').length,
        injectedScripts: document.querySelectorAll('.md-prose script').length,
        global: window.__html || window.__html2 || 0,
      }
    })
    assert.equal(info.handlerElements, 0)
    assert.equal(info.injectedScripts, 0)
    assert.equal(info.global, 0)
    // The unknown `<img>` (an event handler is not allow-listed) must not become
    // an editable image node, and the script must remain an inert source block.
    // A trailing empty paragraph is the editor's normal terminal block.
    assert.deepEqual(info.kinds.filter(kind => kind !== 'paragraph'), ['protected_source', 'protected_source'])
  })

  // --- Image persistence -------------------------------------------------

  const imageAttrs = () => page.evaluate(() => {
    let found = null
    window.f.live().view.state.doc.descendants(node => {
      if (node.type.name === 'image' && !found) found = { ...node.attrs }
    })
    return found
  })

  await test('5. a sized and aligned image survives save, reopen, Live and Source', async () => {
    await reset('![描述](./a.png)')
    const serialized = await page.evaluate(async () => {
      const { markdownSchema } = await import('/src/editor/markdown/wysiwyg/MarkdownSchema.ts')
      const { serializeBlock } = await import('/src/editor/markdown/wysiwyg/MarkdownSerializer.ts')
      const image = markdownSchema.nodes.image.create({ src: './a.png', alt: '描述', title: null, width: '50%', align: 'center' })
      return serializeBlock(markdownSchema.nodes.paragraph.create(null, image))
    })
    assert.equal(serialized, '<img src="./a.png" alt="描述" width="50%" align="center" />')

    // Reopen exactly like a saved file, then read the node back.
    await reset(serialized)
    const attrs = await imageAttrs()
    assert.ok(attrs, 'the HTML image must parse back into an editable image node')
    assert.equal(attrs.src, './a.png')
    assert.equal(attrs.width, '50%')
    assert.equal(attrs.align, 'center')

    // Source mode must not rewrite it, and Live must keep the same node.
    await page.evaluate(() => { const m = window.f.manager; m.setMarkdownMode(window.f.id, 'source') })
    await page.waitForFunction(() => !!document.querySelector('.cm-content'))
    assert.equal(await page.evaluate(() => window.f.source()), serialized)
    await page.evaluate(() => { const m = window.f.manager; m.setMarkdownMode(window.f.id, 'live') })
    await page.waitForFunction(() => !!window.f?.ready())
    const again = await imageAttrs()
    assert.equal(again.width, '50%')
    assert.equal(again.align, 'center')
    // The editing toolbar is available again, which only happens for a real node.
    const hasImageNode = await page.evaluate(() => !!document.querySelector('.md-live-image'))
    assert.equal(hasImageNode, true, 'the image keeps its editor node view')
  })

  await test('6. every width preset and alignment round-trips through Markdown', async () => {
    const cases = []
    for (const width of ['25%', '50%', '75%', '100%', 'auto']) {
      for (const align of [null, 'left', 'center', 'right']) cases.push({ width, align })
    }
    const outcome = await page.evaluate(async cases => {
      const { markdownSchema } = await import('/src/editor/markdown/wysiwyg/MarkdownSchema.ts')
      const { serializeBlock } = await import('/src/editor/markdown/wysiwyg/MarkdownSerializer.ts')
      const { parseMarkdown } = await import('/src/editor/markdown/wysiwyg/MarkdownParser.ts')
      const failures = []
      for (const item of cases) {
        const image = markdownSchema.nodes.image.create({ src: './p.png', alt: 'a', title: null, width: item.width, align: item.align })
        const written = serializeBlock(markdownSchema.nodes.paragraph.create(null, image))
        let parsed = null
        parseMarkdown(written).doc.descendants(node => {
          if (node.type.name === 'image' && !parsed) parsed = { ...node.attrs }
        })
        if (!parsed) { failures.push({ item, written, reason: 'not an image node' }); continue }
        if (parsed.width !== item.width || parsed.align !== item.align) failures.push({ item, written, parsed })
        const rewritten = serializeBlock(markdownSchema.nodes.paragraph.create(null, markdownSchema.nodes.image.create(parsed)))
        if (rewritten !== written) failures.push({ item, written, rewritten, reason: 'not stable' })
      }
      return failures
    }, cases)
    assert.deepEqual(outcome, [], 'all 20 width/align combinations must round-trip exactly')
  })

  await test('7. an image with no size attributes stays plain Markdown and is not converted', async () => {
    const plain = '前文\n\n![纯图片](./b.png)\n\n后文'
    await reset(plain)
    assert.equal(await page.evaluate(() => window.f.source()), plain)
    const attrs = await imageAttrs()
    assert.equal(attrs.width, null)
    assert.equal(attrs.align, null)
  })

  // --- Footnote navigation ----------------------------------------------

  const caretPosition = () => page.evaluate(() => {
    const view = window.f.live().view
    return view.state.selection.from
  })

  await test('8. clicking a reference selects its definition, and clicking the badge returns', async () => {
    await reset('正文引用[^n]。\n\n[^n]: 定义正文。')
    await page.waitForSelector('.md-footnote')
    await page.waitForSelector('.md-footnote-def-badge')

    const before = await page.evaluate(() => window.f.source())
    await page.locator('.md-footnote').first().click()
    const atDefinition = await page.evaluate(() => {
      const view = window.f.live().view
      const node = view.state.doc.nodeAt(view.state.selection.from)
      return { name: node?.type.name, label: node?.attrs?.label }
    })
    assert.equal(atDefinition.name, 'footnote_definition', 'reference click lands on the definition node')
    assert.equal(atDefinition.label, 'n')
    assert.equal(await page.evaluate(() => window.f.source()), before, 'navigation never edits the document')

    await page.locator('.md-footnote-def-badge').first().click()
    const back = await caretPosition()
    const atReference = await page.evaluate(pos => {
      const view = window.f.live().view
      const $pos = view.state.doc.resolve(pos)
      return { before: $pos.nodeBefore?.type.name, label: $pos.nodeBefore?.attrs?.label }
    }, back)
    assert.equal(atReference.before, 'footnote_reference')
    assert.equal(atReference.label, 'n')
    assert.equal(await page.evaluate(() => window.f.source()), before)
  })

  await test('9. several references share one definition and a missing definition is reported', async () => {
    await reset('第一[^s] 第二[^s]。\n\n[^s]: 共享。')
    await page.waitForFunction(() => document.querySelectorAll('.md-footnote').length === 2)
    for (const index of [0, 1]) {
      await page.locator('.md-footnote').nth(index).click()
      const name = await page.evaluate(() => {
        const view = window.f.live().view
        return view.state.doc.nodeAt(view.state.selection.from)?.type.name
      })
      assert.equal(name, 'footnote_definition', `reference ${index} reaches the shared definition`)
    }

    const notices = []
    await page.exposeFunction('__notice', text => notices.push(text))
    await page.evaluate(() => window.addEventListener('editor-notice', event => window.__notice(event.detail)))
    await reset('孤立引用[^missing]。')
    await page.locator('.md-footnote').first().click()
    await page.waitForTimeout(120)
    assert.ok(notices.some(text => text.includes('missing')), 'a missing definition yields a clear notice')
    assert.equal(await page.evaluate(() => window.f.source()), '孤立引用[^missing]。', 'no definition is invented')
  })

  await test('10. unused definitions are preserved', async () => {
    const source = '正文。\n\n[^unused]: 未被引用。'
    await reset(source)
    await page.waitForSelector('.md-footnote-def-node')
    assert.equal(await page.evaluate(() => window.f.source()), source)
  })

  console.log('========================================')
  console.log(`All ${results.length} Repair 01 checks passed!`)
  console.log('========================================')

} finally {
  await browser?.close()
  await server.close()
}
