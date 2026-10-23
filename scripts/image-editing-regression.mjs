// Image Editing Controls and Persistence Regression Suite
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { createServer as createSocket } from 'node:net'
import ts from 'typescript'

const output = 'test-results/image-edit'
fs.mkdirSync(output, { recursive: true })
const unitResults = []
const htmlModule = ts.transpileModule(fs.readFileSync('src/editor/markdown/wysiwyg/imageHtml.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { controlledImageHtml, parseControlledImageHtml, normalizeImageWidth } = await import('data:text/javascript;base64,' + Buffer.from(htmlModule).toString('base64'))
for (const value of ['auto', '25%', '160', '320px']) assert.equal(normalizeImageWidth(value), value)
for (const value of ['calc(1px)', '-1', '100vw', {}, 'NaN']) assert.equal(normalizeImageWidth(value), null)
unitResults.push('Width validation accepts HTML pixels and rejects executable/CSS expressions')
for (const src of ['./中文 图片(1).png', 'C:/literal%25/a.png', './a&b.png', './a"b.png']) {
  const attrs = { src, alt: '<中文>&"\'', title: 'title "&"', width: '50%', align: 'center' }
  assert.deepEqual(parseControlledImageHtml(controlledImageHtml(attrs)), attrs)
}
unitResults.push('Controlled HTML round-trips paths, Unicode, quotes and entities')
assert.deepEqual(parseControlledImageHtml('<img src="" alt="empty" />'), { src: '', alt: 'empty', title: null, width: null, align: null })
assert.equal(controlledImageHtml({ src: 'a.png', alt: '', title: null, width: null, align: null }), null)
unitResults.push('Plain Markdown stays Markdown; empty HTML remains repairable')
for (const source of ['<img src="x" onload="run()" />', '<img src="x" width="1" srcset="y" />', '<img src="x" src="y" />', '<img src="x" /><img src="y" />']) assert.equal(parseControlledImageHtml(source), null)
unitResults.push('HTML allow-list rejects executable or ambiguous attribute state')
for (const name of unitResults) console.log('PASS UNIT ' + name)
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

const socket = createSocket()
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))
const server = await createServer({
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null }
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

  await page.goto(`http://127.0.0.1:${port}/test-results/image-edit/index.html`, { timeout: 45000 })
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

  await test('6. Image hydration and toolbar selection do not reparse the atom or change canonical history', async () => {
    const source = '![正常图片](./assets/pixel.png)\n\n![失效图片](broken.png)'
    await page.evaluate(async source => {
      const { LiveImageView } = await import('/src/editor/markdown/wysiwyg/LiveImageView.ts')
      const update = LiveImageView.prototype.update
      window.imageUpdates = 0
      window.restoreImageUpdate = () => { LiveImageView.prototype.update = update }
      LiveImageView.prototype.update = function (...args) { window.imageUpdates++; return update.apply(this, args) }
      window.f.reset(source, true)
    }, source)
    try {
      await page.waitForFunction(() => window.f.ready() && document.querySelector('.md-live-image img')?.naturalWidth && document.querySelector('.is-broken-image'))
      const before = await page.evaluate(() => ({ source: window.f.source(), history: window.f.history(), publications: window.f.publications.length, updates: window.imageUpdates }))
      await page.locator('.md-live-image img').click()
      await page.locator('.md-image-toolbar:not([hidden])').waitFor()
      // Let the actual DOM observer and animation-frame work settle. The old
      // implementation repeatedly re-parsed the image and starved this frame.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const after = await page.evaluate(() => ({ source: window.f.source(), history: window.f.history(), publications: window.f.publications.length, updates: window.imageUpdates }))
      assert.equal(after.source, source)
      assert.deepEqual(after, before, 'Image presentation mutations must not cause NodeView updates or document edits')
      assert.equal(await page.locator('.md-live-image.md-image-selected').count(), 1)
    } finally { await page.evaluate(() => window.restoreImageUpdate()) }
  })

  const reset = async source => {
    await page.evaluate(source => window.f.reset(source, true), source)
    await page.waitForFunction(() => window.f.ready())
  }
  const source = () => page.evaluate(() => window.f.source())
  const image = (index = 0) => page.locator('.md-live-image img').nth(index)
  const toolbar = () => page.locator('.md-image-toolbar:not([hidden])')
  const properties = () => page.locator('.md-image-properties:not([hidden])')
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const configureResources = async (errors = {}, sizes = {}) => {
    await page.evaluate(async ({ errors, sizes }) => {
      const { markdownResources } = await import('/src/editor/markdown/images.ts')
      const resources = window.f.manager.getState(window.f.id).facet(markdownResources)
      resources.identity = () => 'image-ux-' + window.resourceRevision
      window.resourceRevision = (window.resourceRevision || 0) + 1
      resources.loadLocal = async path => {
        if (errors[path]) throw errors[path]
        if (path.endsWith('.gif')) return Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0))
        const canvas = document.createElement('canvas'), size = sizes[path] || [320, 180]
        canvas.width = size[0]; canvas.height = size[1]
        canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height)
        const type = path.endsWith('.jpg') ? 'image/jpeg' : path.endsWith('.webp') ? 'image/webp' : 'image/png'
        const data = Uint8Array.from(atob(canvas.toDataURL(type).split(',')[1]), c => c.charCodeAt(0))
        canvas.width = canvas.height = 0
        return data
      }
      window.f.live().refreshResources()
    }, { errors, sizes })
  }
  const assertToolbarBounds = async () => {
    await settle()
    const coords = await page.evaluate(() => {
      const pane = window.f.live().dom.getBoundingClientRect()
      const bar = document.querySelector('.md-image-toolbar:not([hidden])').getBoundingClientRect()
      return { left: bar.left, right: bar.right, top: bar.top, bottom: bar.bottom, paneLeft: pane.left, paneRight: pane.right, paneTop: pane.top, paneBottom: pane.bottom, width: innerWidth, height: innerHeight }
    })
    assert(coords.left >= Math.max(0, coords.paneLeft) && coords.right <= Math.min(coords.width, coords.paneRight), JSON.stringify(coords))
    assert(coords.top >= Math.max(0, coords.paneTop) && coords.bottom <= Math.min(coords.height, coords.paneBottom), JSON.stringify(coords))
    return coords
  }

  await test('7. Plain and numeric-width HTML images use image controls; untouched HTML survives neighbouring edits byte-for-byte', async () => {
    for (const html of ["<img alt='中文 &amp; 测试' src='./images/中文 图片.png' />", '<img src="a.png" width="160" alt="HTML" title="test" />', '<img src="" alt="空" />']) {
      const original = `before\n\n${html}\n\nafter\n`
      await reset(original)
      assert.equal(await page.locator('.md-live-image').count(), 1)
      await page.evaluate(() => { window.f.caret('after'); window.f.insert('!') })
      assert((await source()).includes(html))
      await page.evaluate(() => window.f.undo())
      assert.equal(await source(), original)
    }
  })

  await test('8. Strict HTML allow-list rejects handlers, style, srcset, duplicates, extra elements and unsafe widths without executing markup', async () => {
    const result = await page.evaluate(async () => {
      const { parseControlledImageHtml } = await import('/src/editor/markdown/wysiwyg/imageHtml.ts')
      return ['<img src="a" onerror="alert(1)" />', '<img src="a" style="width:1px" />', '<img src="a" srcset="b 2x" />', '<img src="a" src="b" />', '<img src="a" /><script>alert(1)</script>', '<img src="a" width="calc(1px)" />'].map(parseControlledImageHtml)
    })
    assert(result.every(value => value === null))
    await reset('<img src="a.png" onerror="window.imageUnsafe=1" />')
    assert.equal(await page.locator('.md-live-image').count(), 0)
    assert.equal(await page.evaluate(() => window.imageUnsafe), undefined)
  })

  await test('9. Structured errors are human-readable, distinct, recoverable and never inject alt markup', async () => {
    const errors = {
      'missing.png': { code: 'deleted', message: 'os error 2' },
      'scope.png': { code: 'image_scope', message: 'denied' },
      'format.png': { code: 'image_format', message: 'bad format' },
      'budget.png': { code: 'image_size', message: 'over budget' },
      'unknown.png': { nested: { message: 'unknown' } },
    }
    await reset(Object.keys(errors).map(path => `![<img onerror=alert(1)>](${path})`).join('\n\n'))
    await configureResources(errors)
    await page.waitForFunction(() => document.querySelectorAll('.md-image-media.is-broken-image').length === 5)
    const text = await page.locator('.md-prose').innerText()
    for (const expected of ['文件不存在', '文件未授权', '格式不支持', '安全预算', '加载失败']) assert(text.includes(expected), expected)
    assert(!text.includes('[object Object]'))
    assert.equal(await page.locator('.md-prose [onerror]').count(), 0)
    assert.equal(await page.locator('.md-image-media button', { hasText: '授权此本地图片' }).count(), 1)
    await page.locator('.broken-image-tag').first().click()
    await properties().waitFor()
    assert.equal(await properties().getByRole('textbox', { name: '图片路径', exact: true }).inputValue(), 'missing.png')
  })

  await test('10. Empty path opens properties directly and applying path/alt/title/width/align is one reversible edit', async () => {
    await reset('before\n\n![空]()\n\nafter')
    await page.locator('.broken-image-tag').click()
    await properties().getByRole('textbox', { name: '图片路径', exact: true }).fill('./中文 图片(1).png')
    await properties().getByRole('textbox', { name: '图片替代文字', exact: true }).fill('新的 alt <b>')
    await properties().getByRole('textbox', { name: '图片标题', exact: true }).fill('标题 "&"')
    await properties().getByRole('textbox', { name: '图片宽度', exact: true }).fill('160')
    await properties().getByRole('combobox', { name: '图片对齐', exact: true }).selectOption('center')
    const before = await source()
    await properties().getByRole('button', { name: '应用图片', exact: true }).click()
    const changed = await source()
    assert(changed.includes('src="./中文 图片(1).png"') && changed.includes('width="160"') && changed.includes('align="center"'))
    await page.evaluate(() => window.f.undo()); assert.equal(await source(), before)
    await page.evaluate(() => window.f.redo()); assert.equal(await source(), changed)
    await reset(changed)
    assert.equal(await page.locator('.md-live-image').count(), 1)
    assert.equal(await source(), changed)
    await image().click({ button: 'right' })
    assert.equal(await properties().getByRole('textbox', { name: '图片标题', exact: true }).inputValue(), '标题 "&"')
    await page.keyboard.press('Escape'); assert.equal(await properties().count(), 0)
  })

  await test('11. Small images, wide toolbar, all widths and all alignments remain within actual DOM viewport bounds in both themes', async () => {
    for (const light of [true, false]) {
      await page.evaluate(light => document.body.classList.toggle('light', light), light)
      await reset('before\n\n![tiny](tiny.png)\n\nafter')
      await configureResources({}, { 'tiny.png': [24, 24] })
      await image().click()
      await settle()
      const overlapsText = await page.evaluate(() => {
        const bar = document.querySelector('.md-image-toolbar:not([hidden])').getBoundingClientRect()
        return [...document.querySelectorAll('.md-prose p')].filter(p => !p.querySelector('.md-live-image')).some(p => {
          const range = document.createRange(); range.selectNodeContents(p)
          return [...range.getClientRects()].some(rect => rect.right > bar.left && rect.left < bar.right && rect.bottom > bar.top && rect.top < bar.bottom)
        })
      })
      assert.equal(overlapsText, false, 'toolbar must not cover the neighbouring text lines')
      for (const width of ['25', '50', '75', '100', 'auto']) {
        await toolbar().locator(`.md-img-width-${width}`).click()
        await assertToolbarBounds()
      }
      for (const align of ['left', 'center', 'right']) {
        await toolbar().locator(`.md-img-align-${align}`).click()
        await assertToolbarBounds()
        const coordinates = await image().evaluate(el => {
          const image = el.getBoundingClientRect(), wrapper = el.closest('.md-live-image').getBoundingClientRect()
          return { left: image.left, right: image.right, center: (image.left + image.right) / 2, wrapperLeft: wrapper.left, wrapperRight: wrapper.right, wrapperCenter: (wrapper.left + wrapper.right) / 2 }
        })
        if (align === 'left') assert(Math.abs(coordinates.left - coordinates.wrapperLeft) < 1)
        if (align === 'center') assert(Math.abs(coordinates.center - coordinates.wrapperCenter) < 1)
        if (align === 'right') assert(Math.abs(coordinates.right - coordinates.wrapperRight) < 1)
      }
      await page.screenshot({ path: `${output}/${light ? 'light' : 'dark'}-toolbar.png` })
    }
  })

  await test('12. Long and oversized images are constrained; oversized decode gets an actionable budget error', async () => {
    await reset('![tall](tall.png)\n\n![large](large.png)\n\nEND')
    await configureResources({}, { 'tall.png': [600, 6000], 'large.png': [5000, 4000] })
    await page.waitForFunction(() => document.querySelector('.md-live-image img')?.naturalHeight === 6000 && document.querySelector('.broken-image-tag')?.textContent.includes('预算'))
    const size = await image().boundingBox()
    assert(size.height <= 600 && size.height <= 800 * .7 + 1)
    await image().click(); await assertToolbarBounds()
    assert.equal(await page.evaluate(() => window.f.live().dom.scrollWidth <= window.f.live().dom.clientWidth), true)
  })

  await test('13. Continuous images and mixed paragraphs keep distinct targets and inline layout after alignment', async () => {
    await reset('前文 ![A](a.png) 中间 ![B](b.png) 后文\n\nTAIL')
    await image(0).click(); await toolbar().locator('.md-img-width-25').click()
    await toolbar().locator('.md-img-align-center').click()
    assert.equal(await page.locator('.md-live-image').first().evaluate(el => getComputedStyle(el).display), 'inline-block')
    assert((await source()).includes('前文 <img') && (await source()).includes('中间 ![B](b.png) 后文'))
    await image(1).click(); await toolbar().locator('.md-img-width-50').click()
    assert.equal(await page.locator('.md-image-selected').count(), 1)
    const attrs = await page.evaluate(() => [window.f.node('image', 0).node.attrs.width, window.f.node('image', 1).node.attrs.width])
    assert.deepEqual(attrs, ['25%', '50%'])
    await page.keyboard.press('Escape'); assert.equal(await toolbar().count(), 0)
    await page.locator('.md-prose p').last().click(); await page.keyboard.insertText('继续输入')
    assert((await source()).includes('继续输入'))
  })

  await test('14. Image selection/deletion/undo/redo works with real Delete and Backspace key events', async () => {
    for (const key of ['Delete', 'Backspace']) {
      const original = 'before\n\n![a](a.png)\n\nafter'
      await reset(original); await image().click(); await page.keyboard.press(key)
      assert.equal(await page.locator('.md-live-image').count(), 0)
      await page.evaluate(() => window.f.undo()); assert.equal(await source(), original)
      await page.evaluate(() => window.f.redo()); assert.equal(await page.locator('.md-live-image').count(), 0)
    }
  })

  await test('15. Scrolling, resizing and a second narrow pane reposition the selected toolbar using actual bounds', async () => {
    await reset('TOP\n\n' + 'paragraph\n\n'.repeat(12) + '![a](a.png)\n\n' + 'tail\n\n'.repeat(12))
    await image().click(); await assertToolbarBounds()
    await page.evaluate(() => { window.f.live().dom.scrollTop += 50 })
    await assertToolbarBounds()
    await page.setViewportSize({ width: 700, height: 520 })
    await image().click(); await assertToolbarBounds()
    await page.evaluate(() => window.f.split())
    await page.waitForFunction(() => window.f.ready() && document.querySelectorAll('.markdown-live .md-prose').length === 2)
    await page.locator('section[data-pane]').last().locator('.md-live-image img').click()
    await assertToolbarBounds()
    assert.equal(await page.evaluate(() => [...window.f.manager.liveViews.values()].every(({ editor }) => editor.dom.scrollWidth <= editor.dom.clientWidth)), true)
    await page.screenshot({ path: `${output}/narrow-panes.png` })
    await page.setViewportSize({ width: 1200, height: 800 })
  })

  await test('16. Preview fit/original/zoom/pan/resize/Escape/backdrop never change source, history, selection or scroll', async () => {
    await reset('TOP\n\n![tall](tall.png)\n\nEND')
    await configureResources({}, { 'tall.png': [600, 6000] })
    await page.waitForFunction(() => document.querySelector('.md-live-image img')?.naturalHeight === 6000)
    await image().click()
    const before = await page.evaluate(() => ({ source: window.f.source(), history: window.f.history(), scroll: window.f.live().dom.scrollTop, selection: window.f.live().selection }))
    await image().dblclick()
    const preview = page.getByRole('dialog', { name: '图片放大预览' })
    await preview.getByRole('button', { name: '原始大小', exact: true }).click()
    await preview.getByRole('button', { name: '放大', exact: true }).click()
    await preview.getByRole('button', { name: '缩小', exact: true }).click()
    const surface = preview.locator('.md-image-lightbox-surface'), box = await surface.boundingBox()
    await page.mouse.move(box.x + 100, box.y + 250); await page.mouse.down(); await page.mouse.move(box.x + 80, box.y + 70); await page.mouse.up()
    assert(await surface.evaluate(el => el.scrollTop) > 0)
    await preview.getByRole('button', { name: '适应窗口', exact: true }).click()
    await page.setViewportSize({ width: 900, height: 600 })
    await page.keyboard.press('Escape'); await settle()
    await page.setViewportSize({ width: 1200, height: 800 })
    const after = await page.evaluate(() => ({ source: window.f.source(), history: window.f.history(), scroll: window.f.live().dom.scrollTop, selection: window.f.live().selection, focus: window.f.live().view.hasFocus() }))
    assert.equal(after.source, before.source); assert.deepEqual(after.history, before.history); assert.deepEqual(after.selection, before.selection); assert.equal(after.focus, true)
    assert(Math.abs(after.scroll - before.scroll) < 2)
    for (let n = 0; n < 5; n++) { await image().dblclick(); await page.mouse.click(2, 2); await preview.waitFor({ state: 'hidden' }) }
    assert.equal(await source(), before.source)
  })

  await test('17. Source/Live/Split and canonical reopen preserve image semantics and unrelated Markdown', async () => {
    const original = '# Title\n\n![a](<./中文 图片(1).png> "caption")\n\n前 <img src="b.png" width="25%" alt="&lt;keep&gt;" /> 后\n\n- ![c](c.png)\n\n> ![d](d.png)\n\n| 图片 | 文本 |\n| --- | --- |\n| ![e](e.png) | keep |\n'
    await reset(original)
    for (const mode of ['source', 'split', 'live', 'source', 'live']) {
      await page.evaluate(mode => window.f.manager.setMarkdownMode(window.f.id, mode), mode)
      await page.waitForFunction(() => window.f.ready())
      assert.equal(await source(), original)
    }
    await reset(await source()); assert.equal(await source(), original)
    assert.equal(await page.locator('.md-live-image').count(), 5)
  })

  await test('18. PNG/JPEG/GIF/WebP decode and remote consent is explicit; consented remote failure exposes retry', async () => {
    await reset('![png](a.png)\n\n![jpg](a.jpg)\n\n![gif](a.gif)\n\n![webp](a.webp)\n\n![net](https://image-ux.invalid/test.png)')
    await configureResources()
    await page.waitForFunction(() => [...document.querySelectorAll('.md-live-image img')].length === 4 && [...document.querySelectorAll('.md-live-image img')].every(img => img.naturalWidth))
    const requests = []
    await page.route('https://image-ux.invalid/**', async route => { requests.push(route.request().url()); await route.abort() })
    assert.equal(requests.length, 0)
    await page.getByRole('button', { name: /加载网络图片/ }).click()
    await page.waitForFunction(() => document.querySelector('.broken-image-tag')?.textContent.includes('加载失败'))
    assert.equal(requests.length, 1)
    assert(await page.getByRole('button', { name: '重试', exact: true }).isVisible())
    await page.unroute('https://image-ux.invalid/**')
  })

  await test('19. Image toolbar insertion opens properties, keeps undo atomic and returns a usable text caret', async () => {
    await reset('')
    await page.evaluate(() => window.f.live().format('image'))
    await properties().waitFor()
    await properties().getByRole('textbox', { name: '图片路径', exact: true }).fill('a.png')
    await properties().getByRole('button', { name: '应用图片', exact: true }).click()
    await page.keyboard.insertText('后文')
    assert((await source()).includes('后文'))
    await reset('')
    await page.evaluate(() => window.f.live().format('image'))
    await properties().waitFor(); await page.keyboard.press('Escape')
    await page.evaluate(() => window.f.undo()); assert.equal(await source(), '')
  })

  await test('20. Property target follows intervening edits and rejects a deleted target; stale local picker cannot overwrite another image', async () => {
    await reset('before\n\n![a](a.png)\n\n![b](b.png)')
    await image(0).click({ button: 'right' })
    await properties().getByRole('textbox', { name: '图片替代文字', exact: true }).fill('mapped')
    await page.evaluate(() => { window.f.caret('before'); window.f.insert('changed') })
    await properties().getByRole('button', { name: '应用图片', exact: true }).click()
    assert((await source()).includes('![mapped](a.png)'))
    await page.evaluate(async () => {
      const { markdownResources } = await import('/src/editor/markdown/images.ts')
      window.f.manager.getState(window.f.id).facet(markdownResources).chooseLocal = () => new Promise(resolve => window.resolveImageChoice = resolve)
    })
    await image(0).click({ button: 'right' }); await properties().getByRole('button', { name: '重新选择本地图片' }).click()
    await page.keyboard.press('Escape')
    await image(1).click({ button: 'right' }); await page.evaluate(() => window.resolveImageChoice('late.png'))
    assert.equal(await properties().getByRole('textbox', { name: '图片路径', exact: true }).inputValue(), 'b.png')
    await page.evaluate(() => { const { pos, node } = window.f.node('image', 1); const view = window.f.live().view; view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize).setMeta('isolated', true)) })
    assert.equal(await properties().count(), 0)
  })

  await test('21. Synthetic composition/selection and keyboard crossing do not change image source or hijack the caret', async () => {
    const original = '前文 ![a](a.png) 后文'
    await reset(original)
    await page.evaluate(() => {
      window.f.range('前文')
      const view = window.f.live().view
      view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
      view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
    })
    await page.waitForFunction(() => !window.f.live().composing)
    assert.equal(await source(), original)
    await page.evaluate(() => window.f.caret('前文'))
    for (let n = 0; n < 5; n++) await page.keyboard.press('ArrowRight')
    await page.keyboard.insertText('中文')
    assert((await source()).includes('中文') && (await source()).includes('a.png'))
  })

  await test('22. Repeated image hydration, selection and preview cycles release ObjectURLs and global listeners', async () => {
    await reset('plain')
    const baseline = await page.evaluate(() => {
      window.imageURLs = new Set()
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL)
      URL.createObjectURL = blob => { const url = create(blob); window.imageURLs.add(url); return url }
      URL.revokeObjectURL = url => { window.imageURLs.delete(url); revoke(url) }
      return window.f.snapshot().globalListeners
    })
    const started = Date.now()
    for (let n = 0; n < 4; n++) {
      await reset(Array.from({ length: 120 }, (_, i) => `![${i}](same.png)`).join('\n\n'))
      await page.waitForFunction(() => document.querySelectorAll('.md-live-image img').length === 120 && [...document.querySelectorAll('.md-live-image img')].every(img => img.naturalWidth))
      await image().click(); await image().dblclick(); await page.keyboard.press('Escape')
      await reset('plain')
      assert.equal(await page.evaluate(() => window.imageURLs.size), 0)
      assert.equal(await page.evaluate(() => window.f.snapshot().globalListeners), baseline)
    }
    fs.writeFileSync(`${output}/performance.json`, JSON.stringify({ cycles: 4, imagesPerCycle: 120, elapsedMs: Date.now() - started, note: 'Lifecycle regression, not a native long-duration heap profile' }, null, 2))
  })

  await test('23. Multi-image import is a single undo step and preserves text on the same line', async () => {
    await reset('before after')
    const result = await page.evaluate(async () => {
      const { ImageImporter, defaultImageRules } = await import('/src/editor/markdown/imageImport.ts')
      const f = window.f
      f.caret('before')
      const released = []
      const importer = new ImageImporter(f.manager, {
        import: async input => ({ path: 'C:/fixture/' + input.name, name: input.name }),
        authorize: async () => true,
        release: async tokens => { released.push(...tokens) },
      }, async () => true, () => ({ ...defaultImageRules(), location: 'original' }))
      await importer.insert(f.id, [{ token: 'image-a', name: 'a.png' }, { token: 'image-b', name: 'b.png' }])
      const after = f.source()
      f.undo()
      return { after, undo: f.source(), released }
    })
    assert(!result.after.includes('\n'), result.after)
    assert(result.after.includes('a.png') && result.after.includes('b.png') && result.after.endsWith(' after'))
    assert.equal(result.undo, 'before after')
    assert.deepEqual(result.released, ['image-a', 'image-b'])
  })

  await test('24. Local authorization is explicit and retry recovers without changing the source', async () => {
    await reset('![a](scope.png)')
    await page.evaluate(async () => {
      const { markdownResources } = await import('/src/editor/markdown/images.ts')
      const r = window.f.manager.getState(window.f.id).facet(markdownResources), load = r.loadLocal
      window.authorizeCalls = 0; let allowed = false
      r.identity = () => 'scope-test'
      r.loadLocal = async path => { if (!allowed) throw { code: 'image_scope', message: 'denied' }; return load(path) }
      r.authorizeLocal = async () => { window.authorizeCalls++; allowed = true; return true }
      window.f.live().refreshResources()
    })
    const before = await source()
    await page.getByRole('button', { name: '授权此本地图片…', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.authorizeCalls), 0)
    await page.getByRole('button', { name: '授权此本地图片…', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.md-live-image img')?.naturalWidth)
    assert.equal(await page.evaluate(() => window.authorizeCalls), 1)
    assert.equal(await source(), before)
  })

  await test('25. Typing Markdown image syntax in Live converts the image and leaves a text caret after it', async () => {
    await reset('Start ')
    await page.evaluate(() => window.f.caret('Start'))
    await page.keyboard.type(' ![typed](./a.png)')
    await image().waitFor()
    await page.keyboard.type(' END')
    assert((await source()).includes('![typed](./a.png) END'))
  })

  console.log(`========================================`)
  console.log(`All ${results.length} Image editing regression tests passed successfully!`)
  console.log(`========================================`)
  fs.writeFileSync(`${output}/results.json`, JSON.stringify({ unit: unitResults, automatedBrowser: results, nativeGUI: 'Recorded separately in docs/image-ux-audit.md; this suite does not validate a Windows desktop or real IME.' }, null, 2))

} finally {
  await browser?.close()
  await server.close()
}
