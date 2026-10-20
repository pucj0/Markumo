// Exercise canonical undo through the real DocumentManager and lazy Live editor.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'test-results/phase07/undo'
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><div id="app" style="display:flex;height:720px"></div><script type="module" src="/scripts/fixtures/markdown-live-controller.js"></script>')
const server = await createServer({ server: { host: '127.0.0.1', port: 1478, strictPort: true, hmr: false, watch: null } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.MARKUMO_CHROME })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:1478/${output}/index.html`)
  await page.waitForFunction(() => window.f)
  const source = '# Prefix\n\nTarget paragraph.\n\nRepeated paragraph.\n\nRepeated paragraph.\n\nSuffix sentinel.\n\n[ref]: ./old.md\n'
  await page.evaluate(text => window.f.reset(text), source)
  await page.waitForFunction(() => window.f.ready())
  await page.evaluate(() => {
    const f = window.f
    window.untouched = [...document.querySelectorAll('.md-prose p')].find(p => p.textContent === 'Suffix sentinel.')
    window.untouchedBlock = f.live().bridge.blocks.find(block => block.raw === 'Suffix sentinel.')
    f.caret('Target paragraph.'); f.insert(' EDIT')
  })
  const edited = await page.evaluate(() => window.f.source())
  await page.evaluate(async () => {
    const { markdownParser } = await import('/src/editor/markdown/wysiwyg/MarkdownParser.ts')
    const parse = markdownParser.parse.bind(markdownParser)
    window.blockParses = 0
    markdownParser.parse = (...args) => { window.blockParses++; return parse(...args) }
  })
  for (const action of ['undo', 'redo', 'undo', 'redo']) {
    await page.evaluate(() => { window.blockParses = 0 })
    await page.evaluate(action => window.f[action](), action)
    await page.waitForFunction(() => window.f.ready())
    assert.equal(await page.evaluate(() => window.f.source()), action === 'undo' ? source : edited)
    const stable = await page.evaluate(() => {
      const current = window.f.live().bridge.blocks.find(block => block.raw === 'Suffix sentinel.')
      return { node: current.node === window.untouchedBlock.node, id: current.id === window.untouchedBlock.id,
        dom: window.untouched.isConnected && window.untouched.textContent === 'Suffix sentinel.' }
    })
    assert.deepEqual(stable, { node: true, id: true, dom: true }, `${action}: unchanged suffix must retain its source identity, immutable node and DOM`)
    assert(await page.evaluate(() => window.blockParses <= 3), `${action}: canonical history must not reparse each unchanged block`)
  }
  // Identical raw text can render differently after a reference definition changes.
  await page.evaluate(() => window.f.reset('[link][ref]\n\nTail.\n\n[ref]: ./old.md\n'))
  await page.waitForFunction(() => window.f.ready())
  await page.evaluate(() => {
    const f = window.f, start = f.source().indexOf('./old.md')
    f.manager.dispatch(f.id, { changes: { from: start, to: start + './old.md'.length, insert: './new.md' } })
  })
  await page.waitForFunction(() => window.f.ready())
  assert.equal(await page.locator('.md-prose a').getAttribute('data-href'), './new.md')
  await page.evaluate(() => window.f.undo())
  await page.waitForFunction(() => window.f.ready())
  assert.equal(await page.locator('.md-prose a').getAttribute('data-href'), './old.md')
  const contexts = [
    '---\ntitle: YAML\n---\n\nTail.\n',
    'Prefix.\n\n---\ntitle: YAML\n---\n\nTail.\n',
    '# Heading\n\n```js\nconst n = 1\n```\n\n<div>HTML</div>\n',
    '- one\n- two\n\n> quote\n\nRepeated.\n\nRepeated.\n',
    '| A | B |\n|---|---|\n| one | two |\n\nMath $x^2$.\n\n[^n]: note\n',
    'CRLF first.\r\n\r\n**Bold** and [reference][r].\r\n\r\n[r]: ./target.md\r\n',
  ]
  for (const text of contexts) {
    await page.evaluate(text => {
      const f = window.f
      f.manager.dispatch(f.id, { changes: { from: 0, to: f.source().length, insert: text } })
    }, text)
    await page.waitForFunction(() => window.f.ready())
    const equivalent = await page.evaluate(async () => {
      const { parseMarkdown } = await import('/src/editor/markdown/wysiwyg/MarkdownParser.ts')
      const clean = json => JSON.parse(JSON.stringify(json, (key, value) => key === 'sourceId' ? undefined : value))
      return JSON.stringify(clean(window.f.live().bridge.doc.toJSON())) === JSON.stringify(clean(parseMarkdown(window.f.source()).doc.toJSON()))
    })
    assert(equivalent, 'Reused nodes must have the same semantic tree as a fresh parse across context changes')
    // CM stores LF internally; the existing DocumentManager EOL regressions
    // separately assert CRLF/BOM persistence at saveSnapshot's disk boundary.
    assert.equal(await page.evaluate(() => window.f.source()), text.replaceAll('\r\n', '\n'))
  }
  await page.evaluate(() => window.f.reset('Head.\n\nSame.\n\nMiddle.\n\nSame.\n\nTail.\n'))
  await page.waitForFunction(() => window.f.ready())
  await page.evaluate(() => {
    const f = window.f, from = f.source().indexOf('Middle.')
    f.manager.dispatch(f.id, { changes: { from, insert: 'Same.\n\n' } })
  })
  await page.waitForFunction(() => window.f.ready())
  assert(await page.evaluate(() => {
    const ids = window.f.live().bridge.blocks.map(block => block.id)
    return new Set(ids).size === ids.length
  }), 'Inserting a repeated block must never duplicate source IDs used by an unchanged suffix')
  const duplicateSource = await page.evaluate(() => window.f.source())
  await page.evaluate(() => { window.f.caret('Same.'); window.f.insert(' EDIT') })
  assert.equal(await page.evaluate(() => window.f.source()), duplicateSource.replace('Same.', 'Same. EDIT'))
  await page.evaluate(() => window.f.undo())
  assert.equal(await page.evaluate(() => window.f.source()), duplicateSource)
  assert.deepEqual(errors, [])
  console.log('PASS canonical undo/redo retains unchanged block IDs, PM nodes and DOM; changed references still update')
} finally { await browser?.close(); await server.close() }
